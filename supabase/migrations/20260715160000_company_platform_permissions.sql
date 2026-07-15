-- Perfis de permissão da plataforma + cadastro de acesso por e-mail (pré-registro).

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table if not exists public.company_permission_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  is_system boolean not null default false,
  permissions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);

comment on table public.company_permission_profiles is
  'Perfis de acesso à plataforma por empresa. Owner ignora perfil (acesso total).';

create index if not exists company_permission_profiles_company_idx
  on public.company_permission_profiles (company_id);

create table if not exists public.company_platform_access (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  email text not null,
  email_normalized text generated always as (lower(trim(email))) stored,
  permission_profile_id uuid not null references public.company_permission_profiles (id) on delete restrict,
  invited_by uuid references auth.users (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'revoked')),
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (company_id, email_normalized)
);

comment on table public.company_platform_access is
  'Cadastro de e-mail para acesso à plataforma; vincula user_companies no registro/login.';

create index if not exists company_platform_access_email_idx
  on public.company_platform_access (email_normalized, status);

-- ---------------------------------------------------------------------------
-- user_companies: owner | member + perfil
-- ---------------------------------------------------------------------------

alter table public.user_companies
  add column if not exists permission_profile_id uuid
    references public.company_permission_profiles (id) on delete set null;

-- Remove operadores de plataforma (WhatsApp usa company_members).
delete from public.user_companies
where role = 'operador';

-- Gestor vira membro de plataforma.
update public.user_companies
set role = 'member'
where role = 'gestor';

alter table public.user_companies
  drop constraint if exists user_companies_role_check;

alter table public.user_companies
  add constraint user_companies_role_check
  check (role in ('owner', 'member'));

-- Membros sem perfil recebem o Membro system da empresa (backfill após seed).
-- Owner não usa permission_profile_id.

-- ---------------------------------------------------------------------------
-- Permissões default (Membro = todas as seções da sidebar, exceto gestão de acessos)
-- ---------------------------------------------------------------------------

create or replace function public.default_member_permission_keys()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_array(
    'dashboard',
    'despesas',
    'recebimento',
    'checklists',
    'fornecedores',
    'produtos',
    'contas_a_pagar',
    'vendas_realizadas',
    'dre',
    'alertas',
    'integracoes',
    'configuracoes'
  );
$$;

create or replace function public.seed_company_permission_profiles(p_company_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  insert into public.company_permission_profiles (
    company_id,
    name,
    is_system,
    permissions
  )
  values (
    p_company_id,
    'Membro',
    true,
    public.default_member_permission_keys()
  )
  on conflict (company_id, name) do update
    set permissions = excluded.permissions,
        updated_at = now()
  returning id into v_profile_id;

  return v_profile_id;
end;
$$;

comment on function public.seed_company_permission_profiles(uuid) is
  'Cria/atualiza perfil system Membro para a empresa.';

-- Seed para empresas existentes
do $$
declare
  r record;
  v_profile_id uuid;
begin
  for r in select id from public.companies loop
    v_profile_id := public.seed_company_permission_profiles(r.id);

    update public.user_companies uc
    set
      role = 'member',
      permission_profile_id = v_profile_id
    where uc.company_id = r.id
      and uc.role = 'member'
      and uc.permission_profile_id is null;
  end loop;
end;
$$;

create or replace function public.trg_companies_seed_permission_profiles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_company_permission_profiles(new.id);
  return new;
end;
$$;

drop trigger if exists companies_seed_permission_profiles on public.companies;
create trigger companies_seed_permission_profiles
  after insert on public.companies
  for each row
  execute function public.trg_companies_seed_permission_profiles();

-- ---------------------------------------------------------------------------
-- Helpers de permissão
-- ---------------------------------------------------------------------------

create or replace function public.user_is_company_owner(
  p_user_id uuid,
  p_company_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_companies uc
    where uc.user_id = p_user_id
      and uc.company_id = p_company_id
      and uc.role = 'owner'
  );
$$;

create or replace function public.user_company_permissions(
  p_user_id uuid,
  p_company_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.user_companies uc
      where uc.user_id = p_user_id
        and uc.company_id = p_company_id
        and uc.role = 'owner'
    ) then jsonb_build_array('*')
    else coalesce(
      (
        select p.permissions
        from public.user_companies uc
        join public.company_permission_profiles p on p.id = uc.permission_profile_id
        where uc.user_id = p_user_id
          and uc.company_id = p_company_id
          and uc.role = 'member'
      ),
      '[]'::jsonb
    )
  end;
$$;

create or replace function public.user_company_has_permission(
  p_user_id uuid,
  p_company_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from jsonb_array_elements_text(public.user_company_permissions(p_user_id, p_company_id)) k
    where k = '*' or k = p_permission
  );
$$;

-- ---------------------------------------------------------------------------
-- Aceitar acessos pendentes (registro / login)
-- ---------------------------------------------------------------------------

create or replace function public.accept_company_platform_access_for_user(
  p_user_id uuid,
  p_email text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  r record;
  v_count int := 0;
begin
  if v_email = '' then
    return 0;
  end if;

  for r in
    select a.id, a.company_id, a.permission_profile_id
    from public.company_platform_access a
    where a.email_normalized = v_email
      and a.status = 'pending'
  loop
    if not exists (
      select 1 from public.user_companies uc
      where uc.user_id = p_user_id and uc.company_id = r.company_id
    ) then
      insert into public.user_companies (
        user_id,
        company_id,
        role,
        permission_profile_id
      )
      values (
        p_user_id,
        r.company_id,
        'member',
        r.permission_profile_id
      );
    end if;

    update public.company_platform_access
    set
      status = 'active',
      user_id = p_user_id,
      accepted_at = now()
    where id = r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.accept_my_pending_platform_access()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    return 0;
  end if;

  select u.email into v_email
  from auth.users u
  where u.id = v_uid;

  return public.accept_company_platform_access_for_user(v_uid, v_email);
end;
$$;

grant execute on function public.accept_my_pending_platform_access() to authenticated;
grant execute on function public.user_company_has_permission(uuid, uuid, text) to authenticated;

-- Hook pós-registro
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));

  perform public.accept_company_platform_access_for_user(new.id, new.email);

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.company_permission_profiles enable row level security;
alter table public.company_platform_access enable row level security;

-- Perfis: membros leem; owner gere
create policy "company_permission_profiles_select_member"
  on public.company_permission_profiles
  for select
  to authenticated
  using (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  );

create policy "company_permission_profiles_insert_owner"
  on public.company_permission_profiles
  for insert
  to authenticated
  with check (
    public.user_is_company_owner(auth.uid(), company_id)
    and is_system = false
  );

create policy "company_permission_profiles_update_owner"
  on public.company_permission_profiles
  for update
  to authenticated
  using (public.user_is_company_owner(auth.uid(), company_id))
  with check (
    public.user_is_company_owner(auth.uid(), company_id)
    and (is_system = false or name = 'Membro')
  );

create policy "company_permission_profiles_delete_owner"
  on public.company_permission_profiles
  for delete
  to authenticated
  using (
    public.user_is_company_owner(auth.uid(), company_id)
    and is_system = false
  );

-- Acessos por e-mail
create policy "company_platform_access_select"
  on public.company_platform_access
  for select
  to authenticated
  using (
    public.user_is_company_owner(auth.uid(), company_id)
    or email_normalized = lower(trim(coalesce(auth.jwt()->>'email', '')))
  );

create policy "company_platform_access_insert_owner"
  on public.company_platform_access
  for insert
  to authenticated
  with check (public.user_is_company_owner(auth.uid(), company_id));

create policy "company_platform_access_update_owner"
  on public.company_platform_access
  for update
  to authenticated
  using (public.user_is_company_owner(auth.uid(), company_id))
  with check (public.user_is_company_owner(auth.uid(), company_id));

create policy "company_platform_access_delete_owner"
  on public.company_platform_access
  for delete
  to authenticated
  using (public.user_is_company_owner(auth.uid(), company_id));

-- user_companies: owner gere membros da plataforma
create policy "user_companies_insert_owner"
  on public.user_companies
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    or public.user_is_company_owner(auth.uid(), company_id)
  );

create policy "user_companies_update_owner"
  on public.user_companies
  for update
  to authenticated
  using (
    user_id = auth.uid()
    or public.user_is_company_owner(auth.uid(), company_id)
  )
  with check (
    (role = 'owner' and public.user_is_company_owner(auth.uid(), company_id))
    or (role = 'member' and (
      user_id = auth.uid()
      or public.user_is_company_owner(auth.uid(), company_id)
    ))
  );

create policy "user_companies_delete_owner"
  on public.user_companies
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    or (
      public.user_is_company_owner(auth.uid(), company_id)
      and role <> 'owner'
    )
  );

-- Integrações: owner ou membro com permissão integracoes
drop policy if exists "Gestor e owner gerenciam integrações da empresa"
  on public.company_integrations;
drop policy if exists "company_integrations_select_member" on public.company_integrations;
drop policy if exists "company_integrations_insert_gestor" on public.company_integrations;
drop policy if exists "company_integrations_update_gestor" on public.company_integrations;
drop policy if exists "company_integrations_delete_gestor" on public.company_integrations;
drop policy if exists "company_integrations_write_perm" on public.company_integrations;

create policy "company_integrations_select_member"
  on public.company_integrations
  for select
  to authenticated
  using (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  );

create policy "company_integrations_write_insert"
  on public.company_integrations
  for insert
  to authenticated
  with check (
    public.user_company_has_permission(auth.uid(), company_id, 'integracoes')
  );

create policy "company_integrations_write_update"
  on public.company_integrations
  for update
  to authenticated
  using (
    public.user_company_has_permission(auth.uid(), company_id, 'integracoes')
  )
  with check (
    public.user_company_has_permission(auth.uid(), company_id, 'integracoes')
  );

create policy "company_integrations_write_delete"
  on public.company_integrations
  for delete
  to authenticated
  using (
    public.user_company_has_permission(auth.uid(), company_id, 'integracoes')
  );

grant execute on function public.user_is_company_owner(uuid, uuid) to authenticated;
grant execute on function public.seed_company_permission_profiles(uuid) to authenticated;

-- Ativa acesso imediato se o e-mail já tiver conta
create or replace function public.trg_company_platform_access_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select u.id into v_user_id
  from auth.users u
  where lower(trim(u.email)) = new.email_normalized
  limit 1;

  if v_user_id is not null then
    perform public.accept_company_platform_access_for_user(v_user_id, new.email);
  end if;

  return new;
end;
$$;

drop trigger if exists company_platform_access_after_insert on public.company_platform_access;
create trigger company_platform_access_after_insert
  after insert on public.company_platform_access
  for each row
  execute function public.trg_company_platform_access_after_insert();

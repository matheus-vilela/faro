-- Adquirentes por empresa (Stone, Cielo, Rede, etc.) e correlação
-- com formas de pagamento e contas bancárias.

-- ---------------------------------------------------------------------------
-- acquirers
-- ---------------------------------------------------------------------------
create table if not exists public.acquirers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  slug text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint acquirers_company_slug_uq unique (company_id, slug)
);

create index if not exists acquirers_company_idx
  on public.acquirers (company_id);

create index if not exists acquirers_company_name_idx
  on public.acquirers (company_id, name);

comment on table public.acquirers is
  'Adquirentes da unidade (Stone, Cielo, Rede, etc.) para correlacionar formas de pagamento e contas.';

drop trigger if exists tr_acquirers_updated_at on public.acquirers;
create trigger tr_acquirers_updated_at
  before update on public.acquirers
  for each row execute procedure public.set_updated_at();

alter table public.acquirers enable row level security;

create or replace function public.user_is_company_member(
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
  );
$$;

grant execute on function public.user_is_company_member(uuid, uuid) to authenticated;
grant execute on function public.user_is_company_member(uuid, uuid) to service_role;

drop policy if exists "acquirers_select_member" on public.acquirers;
drop policy if exists "acquirers_write_member" on public.acquirers;
drop policy if exists "acquirers_insert_member" on public.acquirers;
drop policy if exists "acquirers_update_member" on public.acquirers;
drop policy if exists "acquirers_delete_member" on public.acquirers;

create policy "acquirers_select_member"
  on public.acquirers for select to authenticated
  using (public.user_has_company_access(company_id));

create policy "acquirers_insert_member"
  on public.acquirers for insert to authenticated
  with check (public.user_has_company_access(company_id));

create policy "acquirers_update_member"
  on public.acquirers for update to authenticated
  using (public.user_has_company_access(company_id))
  with check (public.user_has_company_access(company_id));

create policy "acquirers_delete_member"
  on public.acquirers for delete to authenticated
  using (public.user_has_company_access(company_id));

drop policy if exists platform_admins_all on public.acquirers;
create policy platform_admins_all
  on public.acquirers
  for all
  to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

grant select, insert, update, delete on public.acquirers to authenticated;
grant select, insert, update, delete on public.acquirers to service_role;

-- ---------------------------------------------------------------------------
-- FKs opcionais
-- ---------------------------------------------------------------------------
alter table public.payment_methods
  add column if not exists acquirer_id uuid references public.acquirers (id) on delete set null;

create index if not exists payment_methods_acquirer_idx
  on public.payment_methods (acquirer_id);

comment on column public.payment_methods.acquirer_id is
  'Adquirente associado à forma (cartão, voucher, etc.). Nulo = sem correlação.';

alter table public.company_bank_accounts
  add column if not exists acquirer_id uuid references public.acquirers (id) on delete set null;

create index if not exists company_bank_accounts_acquirer_idx
  on public.company_bank_accounts (acquirer_id);

comment on column public.company_bank_accounts.acquirer_id is
  'Adquirente cujos recebíveis caem nesta conta. Nulo = sem correlação.';

-- Impede associar adquirente de outra empresa.
create or replace function public.enforce_acquirer_same_company()
returns trigger
language plpgsql
as $$
begin
  if new.acquirer_id is null then
    return new;
  end if;
  if not exists (
    select 1
    from public.acquirers a
    where a.id = new.acquirer_id
      and a.company_id = new.company_id
  ) then
    raise exception 'O adquirente precisa pertencer à mesma empresa.';
  end if;
  return new;
end;
$$;

drop trigger if exists tr_payment_methods_acquirer_company
  on public.payment_methods;
create trigger tr_payment_methods_acquirer_company
  before insert or update of acquirer_id, company_id
  on public.payment_methods
  for each row execute function public.enforce_acquirer_same_company();

drop trigger if exists tr_company_bank_accounts_acquirer_company
  on public.company_bank_accounts;
create trigger tr_company_bank_accounts_acquirer_company
  before insert or update of acquirer_id, company_id
  on public.company_bank_accounts
  for each row execute function public.enforce_acquirer_same_company();

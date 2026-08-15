-- INSERT em acquirers falhava com
-- "new row violates row-level security policy".
-- FOR ALL + SELECT separado não cobre bem o INSERT ... RETURNING do cliente;
-- a checagem de membro via subquery em user_companies também pode ser
-- filtrada pelo RLS dessa tabela. Função SECURITY DEFINER + políticas
-- explícitas por comando.

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

do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'acquirers'
  loop
    execute format('drop policy if exists %I on public.acquirers', pol.policyname);
  end loop;
end $$;

create policy "acquirers_select_member"
  on public.acquirers
  for select
  to authenticated
  using (public.user_is_company_member(auth.uid(), company_id));

create policy "acquirers_insert_member"
  on public.acquirers
  for insert
  to authenticated
  with check (public.user_is_company_member(auth.uid(), company_id));

create policy "acquirers_update_member"
  on public.acquirers
  for update
  to authenticated
  using (public.user_is_company_member(auth.uid(), company_id))
  with check (public.user_is_company_member(auth.uid(), company_id));

create policy "acquirers_delete_member"
  on public.acquirers
  for delete
  to authenticated
  using (public.user_is_company_member(auth.uid(), company_id));

grant select, insert, update, delete on public.acquirers to authenticated;
grant select, insert, update, delete on public.acquirers to service_role;

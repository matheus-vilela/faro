-- acquirers nasceu depois de 20260731120000_platform_admin_company_access,
-- que só adicionou platform_admins_all nas tabelas já existentes.
-- Admin Faro (profiles.is_admin) configura unidades sem row em
-- user_companies — o INSERT caía na política só de membro e falhava.

drop policy if exists platform_admins_all on public.acquirers;
create policy platform_admins_all
  on public.acquirers
  for all
  to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

drop policy if exists "acquirers_select_member" on public.acquirers;
drop policy if exists "acquirers_insert_member" on public.acquirers;
drop policy if exists "acquirers_update_member" on public.acquirers;
drop policy if exists "acquirers_delete_member" on public.acquirers;

create policy "acquirers_select_member"
  on public.acquirers
  for select
  to authenticated
  using (public.user_has_company_access(company_id));

create policy "acquirers_insert_member"
  on public.acquirers
  for insert
  to authenticated
  with check (public.user_has_company_access(company_id));

create policy "acquirers_update_member"
  on public.acquirers
  for update
  to authenticated
  using (public.user_has_company_access(company_id))
  with check (public.user_has_company_access(company_id));

create policy "acquirers_delete_member"
  on public.acquirers
  for delete
  to authenticated
  using (public.user_has_company_access(company_id));

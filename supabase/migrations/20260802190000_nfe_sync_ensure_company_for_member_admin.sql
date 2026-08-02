-- Admin global (profiles.is_admin) pode acordar sync NF-e de qualquer unidade.

create or replace function public.nfe_sync_ensure_company_for_member(
  p_company_id uuid,
  p_window_start_date date default null,
  p_wake boolean default true
)
returns public.nfe_sync_state
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not (
    public.is_platform_admin()
    or exists (
      select 1
      from public.user_companies uc
      where uc.user_id = auth.uid()
        and uc.company_id = p_company_id
    )
  ) then
    raise exception 'forbidden';
  end if;
  return public.nfe_sync_ensure_company(p_company_id, p_window_start_date, null, p_wake);
end;
$$;

comment on function public.nfe_sync_ensure_company_for_member(uuid, date, boolean) is
  'Garante nfe_sync_state: membro da unidade ou platform admin.';

grant execute on function public.nfe_sync_ensure_company_for_member(uuid, date, boolean) to authenticated;

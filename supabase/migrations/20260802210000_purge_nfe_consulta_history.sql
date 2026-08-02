-- Admin Faro: limpar histórico de consultas NF-e de uma unidade.

create or replace function public.purge_nfe_consulta_history(
  p_company_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int := 0;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not authenticated');
  end if;

  if not public.is_platform_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if p_company_id is null then
    return jsonb_build_object('ok', false, 'error', 'company_id obrigatório');
  end if;

  if not exists (select 1 from public.companies c where c.id = p_company_id) then
    return jsonb_build_object('ok', false, 'error', 'company not found');
  end if;

  delete from public.nfe_consulta_history
  where company_id = p_company_id;

  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'ok', true,
    'deleted_count', v_deleted
  );
end;
$$;

comment on function public.purge_nfe_consulta_history(uuid) is
  'Apaga todo o histórico de consultas NF-e da unidade. Só platform admin.';

revoke all on function public.purge_nfe_consulta_history(uuid) from public;
grant execute on function public.purge_nfe_consulta_history(uuid) to authenticated;

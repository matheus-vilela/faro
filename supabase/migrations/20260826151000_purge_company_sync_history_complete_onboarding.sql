-- Atualiza purge_company_sync_history: conclui onboarding fiscal/PDV e
-- cancela jobs CSV em segundo plano (caso a 20260826150000 já tenha sido aplicada).

create or replace function public.purge_company_sync_history(
  p_company_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nfe_history int := 0;
  v_nfe_jobs int := 0;
  v_epoc_runs int := 0;
  v_epoc_jobs int := 0;
  v_csv_jobs int := 0;
  v_staging int := 0;
  v_fiscal jsonb;
  v_pdv jsonb;
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
  get diagnostics v_nfe_history = row_count;

  delete from public.nfe_jobs
  where company_id = p_company_id;
  get diagnostics v_nfe_jobs = row_count;

  update public.nfe_sync_state
  set
    mode = 'steady',
    status = 'idle',
    priority = 0,
    cycle_id = null,
    running_since = null,
    pending_cursor_versao = null,
    last_error = null,
    next_sync_at = now() + interval '1 hour',
    updated_at = now()
  where company_id = p_company_id;

  if to_regclass('public.focus_get_sync_nfe_staging') is not null then
    execute
      'delete from public.focus_get_sync_nfe_staging where company_id = $1'
      using p_company_id;
    get diagnostics v_staging = row_count;
  end if;

  delete from public.epoc_csv_sync_runs
  where company_id = p_company_id;
  get diagnostics v_epoc_runs = row_count;

  delete from public.epoc_jobs
  where company_id = p_company_id;
  get diagnostics v_epoc_jobs = row_count;

  update public.epoc_sync_state
  set
    mode = 'steady',
    status = 'idle',
    priority = 0,
    cycle_id = null,
    running_since = null,
    last_error = null,
    last_csv_sync_run_id = null,
    last_import_job_id = null,
    next_sync_at = now() + interval '1 hour',
    updated_at = now()
  where company_id = p_company_id;

  if to_regclass('public.integration_csv_revenue_import_jobs') is not null then
    execute
      $sql$
        update public.integration_csv_revenue_import_jobs
        set
          status = 'FAILED',
          error_message = 'cancelado: limpeza de sincronização (Ferramentas)',
          updated_at = now()
        where company_id = $1
          and lower(provider) = 'epoc'
          and upper(status) in ('PENDING', 'PROCESSING')
      $sql$
      using p_company_id;

    execute
      $sql$
        delete from public.integration_csv_revenue_import_jobs
        where company_id = $1
          and lower(provider) = 'epoc'
      $sql$
      using p_company_id;
    get diagnostics v_csv_jobs = row_count;
  end if;

  if to_regclass('public.company_revenue_integration_import_batches') is not null then
    execute
      $sql$
        update public.company_revenue_integration_import_batches
        set
          status = 'failed',
          error_message = 'cancelado: limpeza de sincronização (Ferramentas)',
          updated_at = now()
        where company_id = $1
          and lower(provider) = 'epoc'
          and status in ('pending', 'running')
      $sql$
      using p_company_id;
  end if;

  select
    coalesce(onboarding_fiscal, '{}'::jsonb),
    coalesce(onboarding_pdv, '{}'::jsonb)
  into v_fiscal, v_pdv
  from public.companies
  where id = p_company_id;

  v_fiscal := v_fiscal
    || jsonb_build_object(
      'completed', true,
      'capture_completed', true,
      'sync', false,
      'sefaz_unavailable', false
    );
  v_fiscal := v_fiscal - 'sefaz_unavailable_at' - 'sefaz_retry_at' - 'sefaz_error_detail';

  v_pdv := v_pdv
    || jsonb_build_object(
      'completed', true,
      'sync', false,
      'portal_busy', false,
      'portal_outcome', null,
      'portal_message', null,
      'import_status', 'completed',
      'import_error', null
    );

  update public.companies
  set
    onboarding_fiscal = v_fiscal,
    onboarding_pdv = v_pdv,
    updated_at = now()
  where id = p_company_id;

  return jsonb_build_object(
    'ok', true,
    'nfe_history', v_nfe_history,
    'nfe_jobs', v_nfe_jobs,
    'nfe_staging', v_staging,
    'epoc_runs', v_epoc_runs,
    'epoc_jobs', v_epoc_jobs,
    'csv_jobs', v_csv_jobs,
    'onboarding_completed', true
  );
end;
$$;

comment on function public.purge_company_sync_history(uuid) is
  'Para filas PDV/fiscal em curso, apaga o histórico e conclui os cards de onboarding fiscal e EPOC. Só platform admin. Não apaga notas, XMLs, vendas nem despesas.';

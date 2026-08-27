-- Histórico fiscal: só nfe_consulta_history.
-- O union com focus_get_sync_nfe_staging inventava ciclos "Em curso 0/X"
-- (processed_count sempre 0; a fila de interpretação legada foi dropada).

drop function if exists public.focus_nfe_consulta_history_list(uuid, int);

create or replace function public.focus_nfe_consulta_history_list(
  p_company_id uuid,
  p_limit int default 50
)
returns table (
  exec_id uuid,
  consulta_at timestamptz,
  nfes_encontradas int,
  interpret_status text,
  interpret_error text,
  onboarding boolean,
  staging_xml_total int,
  finished_at timestamptz,
  summary text,
  flow_diagnostic jsonb,
  listed_count int,
  downloaded_count int,
  processed_count int,
  failed_count int,
  ignored_count int
)
language sql
stable
security definer
set search_path = public
as $$
  with access as (
    select (
      auth.uid() is not null
      and (
        public.is_platform_admin()
        or exists (
          select 1
          from public.user_companies uc
          where uc.user_id = auth.uid()
            and uc.company_id = p_company_id
        )
      )
    ) as ok
  )
  select
    h.exec_id,
    h.consulta_at,
    h.nfes_encontradas,
    case
      when h.flow_diagnostic is not null
        and coalesce(h.flow_diagnostic->'phases'->'nfe_search'->>'status', '') = 'pending'
      then 'pending'
      when h.flow_diagnostic is not null
        and coalesce(h.flow_diagnostic->>'blocked_at', '') = 'xml_interpret'
      then 'failed'
      when h.processed_count > 0 or (
        h.nfes_encontradas = 0
        and coalesce(h.flow_diagnostic->'phases'->'nfe_search'->>'status', '') <> 'pending'
      )
      then 'completed'
      when h.downloaded_count > 0
      then 'processing'
      else null
    end as interpret_status,
    case
      when h.flow_diagnostic is not null
        and coalesce(h.flow_diagnostic->>'blocked_at', '') <> ''
      then left(coalesce(h.summary, ''), 500)
      else null
    end as interpret_error,
    h.onboarding,
    h.staging_xml_total,
    h.consulta_at as finished_at,
    h.summary,
    h.flow_diagnostic,
    h.listed_count,
    h.downloaded_count,
    h.processed_count,
    h.failed_count,
    h.ignored_count
  from public.nfe_consulta_history h
  where h.company_id = p_company_id
    and (select ok from access)
  order by h.consulta_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

comment on function public.focus_nfe_consulta_history_list(uuid, int) is
  'Integrações Fiscal: histórico NF-e do pipeline (nfe_consulta_history).';

revoke all on function public.focus_nfe_consulta_history_list(uuid, int) from public;
grant execute on function public.focus_nfe_consulta_history_list(uuid, int) to authenticated;

-- Crons do sync legado (página ~50, processed 0) — o pipeline novo é nfe-dispatcher/worker.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'focus_get_sync_nfe_recebidas') then
    perform cron.unschedule((select jobid from cron.job where jobname = 'focus_get_sync_nfe_recebidas'));
  end if;
  if exists (select 1 from cron.job where jobname = 'focus_get_sync_nfe_onboarding_retry') then
    perform cron.unschedule((select jobid from cron.job where jobname = 'focus_get_sync_nfe_onboarding_retry'));
  end if;
  if exists (select 1 from cron.job where jobname = 'focus_get_sync_nfe_interpret_dispatch') then
    perform cron.unschedule((select jobid from cron.job where jobname = 'focus_get_sync_nfe_interpret_dispatch'));
  end if;
end
$$;

-- Remove fila/processamento de interpretação baseado em focus_get_sync_nfe_interpret_jobs.
-- Staging (focus_get_sync_nfe_staging) permanece; histórico fiscal passa a listar só staging.

do $cron$
begin
  if exists (
    select 1 from cron.job where jobname = 'focus_get_sync_nfe_interpret_dispatch'
  ) then
    perform cron.unschedule(
      (select jobid from cron.job where jobname = 'focus_get_sync_nfe_interpret_dispatch')
    );
  end if;
end;
$cron$;

drop function if exists public.cron_invoke_focus_get_sync_nfe_interpret();
drop function if exists public.focus_get_sync_nfe_interpret_claim_job();
drop function if exists public.focus_interpret_staging_queue_send(uuid);
drop function if exists public.focus_interpret_staging_queue_read(int, int);
drop function if exists public.focus_interpret_staging_queue_delete(bigint);

do $pgmq$
begin
  if exists (
    select 1
    from pgmq.meta
    where queue_name = 'focus_interpret_staging_continue'
  ) then
    perform pgmq.drop_queue('focus_interpret_staging_continue');
  end if;
exception
  when undefined_table then
    -- pgmq.meta pode não existir em ambientes sem a extensão
    null;
  when undefined_function then
    null;
end;
$pgmq$;

drop table if exists public.focus_get_sync_nfe_interpret_jobs cascade;

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
  finished_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.exec_id,
    min(s.created_at) as consulta_at,
    count(*)::int as nfes_encontradas,
    null::text as interpret_status,
    null::text as interpret_error,
    false as onboarding,
    count(*) filter (
      where s.xml_content is not null and btrim(s.xml_content) <> ''
    )::int as staging_xml_total,
    null::timestamptz as finished_at
  from public.focus_get_sync_nfe_staging s
  where s.company_id = p_company_id
    and exists (
      select 1
      from public.user_companies uc
      where uc.user_id = auth.uid()
        and uc.company_id = p_company_id
    )
  group by s.exec_id
  order by min(s.created_at) desc nulls last
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

comment on function public.focus_nfe_consulta_history_list(uuid, int) is
  'Integrações Fiscal: histórico de consultas NF-e recebidas (staging). Sem fila de interpretação.';

grant execute on function public.focus_nfe_consulta_history_list(uuid, int) to authenticated;

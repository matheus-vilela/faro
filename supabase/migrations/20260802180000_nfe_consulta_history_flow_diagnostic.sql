-- Histórico fiscal com diagnóstico em 3 fases (busca → download XML → interpretação).

alter table public.nfe_consulta_history
  add column if not exists summary text,
  add column if not exists flow_diagnostic jsonb,
  add column if not exists listed_count int not null default 0 check (listed_count >= 0),
  add column if not exists downloaded_count int not null default 0 check (downloaded_count >= 0),
  add column if not exists processed_count int not null default 0 check (processed_count >= 0),
  add column if not exists failed_count int not null default 0 check (failed_count >= 0),
  add column if not exists ignored_count int not null default 0 check (ignored_count >= 0);

comment on column public.nfe_consulta_history.flow_diagnostic is
  'Diagnóstico do ciclo: nfe_search → xml_download → xml_interpret.';

comment on table public.nfe_consulta_history is
  'Histórico de consultas SEFAZ/Focus: uma linha por ciclo (inclui busca sem NF-e novas).';

-- CREATE OR REPLACE não pode mudar o tipo de retorno (OUT params).
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
security invoker
set search_path = public
as $$
  with member as (
    select exists (
      select 1
      from public.user_companies uc
      where uc.user_id = auth.uid()
        and uc.company_id = p_company_id
    ) as ok
  ),
  from_history as (
    select
      h.exec_id,
      h.consulta_at,
      h.nfes_encontradas,
      case
        when h.flow_diagnostic is not null
          and coalesce(h.flow_diagnostic->>'blocked_at', '') = 'xml_interpret'
        then 'failed'
        when h.processed_count > 0 or h.nfes_encontradas = 0
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
      and (select ok from member)
  ),
  from_staging as (
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
      null::timestamptz as finished_at,
      null::text as summary,
      null::jsonb as flow_diagnostic,
      count(*)::int as listed_count,
      count(*) filter (
        where s.xml_content is not null and btrim(s.xml_content) <> ''
      )::int as downloaded_count,
      0 as processed_count,
      0 as failed_count,
      0 as ignored_count
    from public.focus_get_sync_nfe_staging s
    where s.company_id = p_company_id
      and (select ok from member)
      and not exists (
        select 1
        from public.nfe_consulta_history h
        where h.company_id = p_company_id
          and h.exec_id = s.exec_id
      )
    group by s.exec_id
  )
  select *
  from (
    select * from from_history
    union all
    select * from from_staging
  ) u
  order by u.consulta_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

comment on function public.focus_nfe_consulta_history_list(uuid, int) is
  'Integrações Fiscal: histórico de consultas NF-e com diagnóstico em fases.';

grant execute on function public.focus_nfe_consulta_history_list(uuid, int) to authenticated;

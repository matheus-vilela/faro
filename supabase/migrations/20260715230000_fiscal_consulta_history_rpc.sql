-- Histórico de consultas NF-e (Focus/SEFAZ) visível em Integrações → Fiscal.

grant select on public.focus_get_sync_nfe_interpret_jobs to authenticated;

create policy "focus_get_sync_nfe_interpret_jobs_select_member"
  on public.focus_get_sync_nfe_interpret_jobs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_companies uc
      where uc.user_id = auth.uid()
        and uc.company_id = focus_get_sync_nfe_interpret_jobs.company_id
    )
  );

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
  with staging_agg as (
    select
      s.exec_id,
      min(s.created_at) as first_at,
      count(*)::int as nfes_count
    from public.focus_get_sync_nfe_staging s
    where s.company_id = p_company_id
    group by s.exec_id
  ),
  jobs as (
    select j.*
    from public.focus_get_sync_nfe_interpret_jobs j
    where j.company_id = p_company_id
  ),
  exec_ids as (
    select exec_id from staging_agg
    union
    select exec_id from jobs
  )
  select
    e.exec_id,
    coalesce(j.created_at, sa.first_at) as consulta_at,
    coalesce(sa.nfes_count, 0) as nfes_encontradas,
    j.status as interpret_status,
    j.last_error as interpret_error,
    coalesce(j.onboarding, false) as onboarding,
    j.staging_xml_total,
    j.finished_at
  from exec_ids e
  left join staging_agg sa on sa.exec_id = e.exec_id
  left join jobs j on j.exec_id = e.exec_id
  where exists (
    select 1
    from public.user_companies uc
    where uc.user_id = auth.uid()
      and uc.company_id = p_company_id
  )
  order by coalesce(j.created_at, sa.first_at) desc nulls last
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

comment on function public.focus_nfe_consulta_history_list(uuid, int) is
  'Integrações Fiscal: histórico de consultas NF-e recebidas (staging + jobs de interpretação).';

grant execute on function public.focus_nfe_consulta_history_list(uuid, int) to authenticated;

-- Histórico append-only de consultas NF-e (pipeline nfe-worker).
-- A UI de Integrações → Fiscal usa focus_nfe_consulta_history_list.

create table if not exists public.nfe_consulta_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  exec_id uuid not null,
  consulta_at timestamptz not null default now(),
  nfes_encontradas int not null default 0 check (nfes_encontradas >= 0),
  staging_xml_total int not null default 0 check (staging_xml_total >= 0),
  onboarding boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, exec_id)
);

create index if not exists nfe_consulta_history_company_at_idx
  on public.nfe_consulta_history (company_id, consulta_at desc);

comment on table public.nfe_consulta_history is
  'Histórico de consultas SEFAZ/Focus: uma linha por ciclo em que houve NF-e para lançar.';

alter table public.nfe_consulta_history enable row level security;

create policy "nfe_consulta_history_select_member"
  on public.nfe_consulta_history for select to authenticated
  using (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  );

grant select on public.nfe_consulta_history to authenticated;
grant select, insert, update, delete on public.nfe_consulta_history to service_role;

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
      null::text as interpret_status,
      null::text as interpret_error,
      h.onboarding,
      h.staging_xml_total,
      h.consulta_at as finished_at
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
      null::timestamptz as finished_at
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
  'Integrações Fiscal: histórico de consultas NF-e (nfe_consulta_history + staging legado).';

grant execute on function public.focus_nfe_consulta_history_list(uuid, int) to authenticated;

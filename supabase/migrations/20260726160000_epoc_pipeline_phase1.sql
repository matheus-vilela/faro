-- Pipeline Epoc Fase 1: fila por jobs (sync → fetch_window → close).
-- Substitui o orquestrador epoc-daily-sync nos crons.
-- fetch_window reutiliza a edge epoc-sync-csv (portal → CSV → import).
-- Steady: 1 busca/dia (next_sync_at = próximo dia civil SP).

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- epoc_sync_state
-- ---------------------------------------------------------------------------
create table if not exists public.epoc_sync_state (
  company_id uuid primary key references public.companies (id) on delete cascade,
  mode text not null default 'onboarding'
    check (mode in ('onboarding', 'steady')),
  status text not null default 'idle'
    check (status in ('idle', 'running', 'backoff', 'needs_attention')),
  priority int not null default 0,
  window_start_date date not null,
  cycle_id uuid,
  last_csv_sync_run_id uuid,
  last_import_job_id uuid,
  last_success_at timestamptz,
  next_sync_at timestamptz not null default now(),
  running_since timestamptz,
  empty_poll_count int not null default 0,
  last_outcome text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists epoc_sync_state_due_idx
  on public.epoc_sync_state (next_sync_at, priority desc)
  where status in ('idle', 'backoff');

create index if not exists epoc_sync_state_mode_priority_idx
  on public.epoc_sync_state (mode, priority desc, next_sync_at);

comment on table public.epoc_sync_state is
  'Estado do pipeline Epoc (vendas/portal) por empresa: modo onboarding/steady, agenda diária.';

alter table public.epoc_sync_state enable row level security;

create policy "epoc_sync_state_select_member"
  on public.epoc_sync_state for select to authenticated
  using (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  );

grant select on public.epoc_sync_state to authenticated;
grant select, insert, update, delete on public.epoc_sync_state to service_role;

-- ---------------------------------------------------------------------------
-- epoc_jobs
-- ---------------------------------------------------------------------------
create table if not exists public.epoc_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null
    check (type in (
      'sync_company', 'fetch_window', 'close_cycle'
    )),
  company_id uuid not null references public.companies (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  priority int not null default 0,
  run_after timestamptz not null default now(),
  status text not null default 'queued'
    check (status in ('queued', 'leased', 'done', 'dead')),
  leased_until timestamptz,
  leased_by text,
  attempts int not null default 0,
  max_attempts int not null default 8,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists epoc_jobs_claim_idx
  on public.epoc_jobs (priority desc, run_after, created_at)
  where status = 'queued';

create index if not exists epoc_jobs_company_open_idx
  on public.epoc_jobs (company_id, status)
  where status in ('queued', 'leased');

create unique index if not exists epoc_jobs_uq_sync_company_open
  on public.epoc_jobs (company_id)
  where type = 'sync_company' and status in ('queued', 'leased');

create unique index if not exists epoc_jobs_uq_fetch_window_open
  on public.epoc_jobs (company_id)
  where type = 'fetch_window' and status in ('queued', 'leased');

create unique index if not exists epoc_jobs_uq_close_cycle_open
  on public.epoc_jobs (company_id)
  where type = 'close_cycle' and status in ('queued', 'leased');

comment on table public.epoc_jobs is
  'Fila do pipeline Epoc: unidades com lease (SKIP LOCKED).';

alter table public.epoc_jobs enable row level security;

grant select, insert, update, delete on public.epoc_jobs to service_role;

-- ---------------------------------------------------------------------------
-- Helpers: janela default (1º dia do mês civil anterior, America/Sao_Paulo)
-- ---------------------------------------------------------------------------
create or replace function public.epoc_default_window_start_date(
  p_ref date default (timezone('America/Sao_Paulo', now()))::date
)
returns date
language plpgsql
immutable
as $$
declare
  y int := extract(year from p_ref)::int;
  m int := extract(month from p_ref)::int;
begin
  m := m - 1;
  while m < 1 loop
    m := m + 12;
    y := y - 1;
  end loop;
  return make_date(y, m, 1);
end;
$$;

comment on function public.epoc_default_window_start_date(date) is
  'Default da janela Epoc onboarding: 1º dia civil do mês anterior (SP).';

-- Próximo sync steady: 06:00 America/Sao_Paulo do dia civil seguinte.
create or replace function public.epoc_next_steady_sync_at(
  p_ref timestamptz default now()
)
returns timestamptz
language plpgsql
stable
as $$
declare
  sp_today date := (timezone('America/Sao_Paulo', p_ref))::date;
  next_day date := sp_today + 1;
begin
  return (next_day + time '06:00') at time zone 'America/Sao_Paulo';
end;
$$;

comment on function public.epoc_next_steady_sync_at(timestamptz) is
  'Agenda steady Epoc: 06:00 SP do próximo dia civil.';

-- ---------------------------------------------------------------------------
-- Enqueue / claim / complete
-- ---------------------------------------------------------------------------
create or replace function public.epoc_jobs_enqueue(
  p_type text,
  p_company_id uuid,
  p_payload jsonb default '{}'::jsonb,
  p_priority int default 0,
  p_run_after timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  begin
    insert into public.epoc_jobs (type, company_id, payload, priority, run_after, status)
    values (
      p_type,
      p_company_id,
      coalesce(p_payload, '{}'::jsonb),
      coalesce(p_priority, 0),
      coalesce(p_run_after, now()),
      'queued'
    )
    returning id into v_id;
    return v_id;
  exception
    when unique_violation then
      null;
  end;

  select j.id into v_id
  from public.epoc_jobs j
  where j.company_id = p_company_id
    and j.type = p_type
    and j.status in ('queued', 'leased')
  order by j.created_at
  limit 1;

  return v_id;
end;
$$;

comment on function public.epoc_jobs_enqueue(text, uuid, jsonb, int, timestamptz) is
  'Enfileira job Epoc com dedupe por unique parcial; devolve id novo ou existente aberto.';

grant execute on function public.epoc_jobs_enqueue(text, uuid, jsonb, int, timestamptz) to service_role;

create or replace function public.epoc_jobs_release_expired_leases()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.epoc_jobs
  set
    status = 'queued',
    leased_until = null,
    leased_by = null,
    updated_at = now(),
    last_error = coalesce(last_error, 'lease expirado')
  where status = 'leased'
    and leased_until is not null
    and leased_until < now();

  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.epoc_jobs_release_expired_leases() to service_role;

create or replace function public.epoc_jobs_claim(
  p_limit int default 5,
  p_worker_id text default 'worker',
  p_lease_seconds int default 300
)
returns setof public.epoc_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.epoc_jobs_release_expired_leases();

  return query
  with picked as (
    select j.id
    from public.epoc_jobs j
    where j.status = 'queued'
      and j.run_after <= now()
    order by j.priority desc, j.run_after asc, j.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 5), 50))
  ),
  updated as (
    update public.epoc_jobs j
    set
      status = 'leased',
      leased_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 300), 900))),
      leased_by = coalesce(nullif(trim(p_worker_id), ''), 'worker'),
      attempts = j.attempts + 1,
      updated_at = now()
    from picked
    where j.id = picked.id
    returning j.*
  )
  select * from updated;
end;
$$;

comment on function public.epoc_jobs_claim(int, text, int) is
  'Claim atómico de jobs queued (SKIP LOCKED) com lease.';

grant execute on function public.epoc_jobs_claim(int, text, int) to service_role;

create or replace function public.epoc_jobs_complete(
  p_job_id uuid,
  p_ok boolean,
  p_error text default null,
  p_retry_after timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.epoc_jobs%rowtype;
begin
  select * into j from public.epoc_jobs where id = p_job_id for update;
  if not found then
    return;
  end if;

  if p_ok then
    update public.epoc_jobs
    set
      status = 'done',
      leased_until = null,
      leased_by = null,
      last_error = null,
      updated_at = now()
    where id = p_job_id;
    return;
  end if;

  if j.attempts >= j.max_attempts then
    update public.epoc_jobs
    set
      status = 'dead',
      leased_until = null,
      leased_by = null,
      last_error = left(coalesce(p_error, 'max attempts'), 2000),
      updated_at = now()
    where id = p_job_id;
    return;
  end if;

  update public.epoc_jobs
  set
    status = 'queued',
    leased_until = null,
    leased_by = null,
    run_after = coalesce(
      p_retry_after,
      now() + make_interval(secs => least(3600, greatest(15, (2 ^ least(j.attempts, 8)) * 5)))
    ),
    last_error = left(coalesce(p_error, 'erro'), 2000),
    updated_at = now()
  where id = p_job_id;
end;
$$;

grant execute on function public.epoc_jobs_complete(uuid, boolean, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Ensure / pick / backfill
-- ---------------------------------------------------------------------------
create or replace function public.epoc_sync_ensure_company(
  p_company_id uuid,
  p_window_start_date date default null,
  p_mode text default null,
  p_wake boolean default true
)
returns public.epoc_sync_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.epoc_sync_state%rowtype;
  v_ob jsonb;
  v_mode text;
  v_window date;
  v_priority int;
  v_completed boolean;
  v_integ record;
begin
  select c.onboarding_pdv
  into v_ob
  from public.companies c
  where c.id = p_company_id;

  if not found then
    raise exception 'company not found: %', p_company_id;
  end if;

  select ci.enabled, ci.settings
  into v_integ
  from public.company_integrations ci
  where ci.company_id = p_company_id
    and ci.provider = 'epoc'
  limit 1;

  if not found or coalesce(v_integ.enabled, false) is not true then
    raise exception 'company sem integração Epoc ativa: %', p_company_id;
  end if;

  if coalesce(nullif(trim(v_integ.settings->>'base_url'), ''), '') = '' then
    raise exception 'company Epoc sem base_url: %', p_company_id;
  end if;

  v_completed := coalesce((v_ob->>'completed')::boolean, false);

  if p_mode in ('onboarding', 'steady') then
    v_mode := p_mode;
  elsif v_completed then
    v_mode := 'steady';
  else
    v_mode := 'onboarding';
  end if;

  v_window := coalesce(p_window_start_date, public.epoc_default_window_start_date());
  v_priority := case when v_mode = 'onboarding' then 100 else 0 end;

  insert into public.epoc_sync_state (
    company_id,
    mode,
    status,
    priority,
    window_start_date,
    next_sync_at
  )
  values (
    p_company_id,
    v_mode,
    'idle',
    v_priority,
    v_window,
    case when coalesce(p_wake, true) then now() else public.epoc_next_steady_sync_at() end
  )
  on conflict (company_id) do update set
    mode = case
      when p_mode in ('onboarding', 'steady') then p_mode
      else public.epoc_sync_state.mode
    end,
    window_start_date = coalesce(p_window_start_date, public.epoc_sync_state.window_start_date),
    priority = greatest(
      public.epoc_sync_state.priority,
      case
        when coalesce(p_mode, public.epoc_sync_state.mode) = 'onboarding' then 100
        else public.epoc_sync_state.priority
      end
    ),
    next_sync_at = case
      when coalesce(p_wake, true) then least(public.epoc_sync_state.next_sync_at, now())
      else public.epoc_sync_state.next_sync_at
    end,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.epoc_sync_ensure_company(uuid, date, text, boolean) is
  'Garante epoc_sync_state para empresa com Epoc ativo; opcionalmente acorda next_sync_at.';

grant execute on function public.epoc_sync_ensure_company(uuid, date, text, boolean) to service_role;

create or replace function public.epoc_sync_ensure_company_for_member(
  p_company_id uuid,
  p_window_start_date date default null,
  p_wake boolean default true
)
returns public.epoc_sync_state
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.user_companies uc
    where uc.user_id = auth.uid() and uc.company_id = p_company_id
  ) then
    raise exception 'forbidden';
  end if;
  return public.epoc_sync_ensure_company(p_company_id, p_window_start_date, null, p_wake);
end;
$$;

grant execute on function public.epoc_sync_ensure_company_for_member(uuid, date, boolean) to authenticated;

create or replace function public.epoc_sync_pick_due_companies(p_limit int default 10)
returns table (company_id uuid, mode text, priority int, next_sync_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select s.company_id, s.mode, s.priority, s.next_sync_at
  from public.epoc_sync_state s
  join public.company_integrations ci
    on ci.company_id = s.company_id
   and ci.provider = 'epoc'
   and ci.enabled = true
  join public.companies c on c.id = s.company_id
  where s.next_sync_at <= now()
    and s.status in ('idle', 'backoff')
    and not exists (
      select 1
      from public.epoc_jobs j
      where j.company_id = s.company_id
        and j.status in ('queued', 'leased')
    )
    -- Onboarding PDV em curso (sync) só corre em mode=onboarding; steady bloqueado.
    and (
      s.mode = 'onboarding'
      or coalesce((c.onboarding_pdv->>'sync')::boolean, false) is not true
    )
  order by s.priority desc, s.next_sync_at asc
  limit greatest(1, least(coalesce(p_limit, 10), 50));
end;
$$;

grant execute on function public.epoc_sync_pick_due_companies(int) to service_role;

create or replace function public.epoc_sync_backfill_missing_states(p_limit int default 50)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
  v_ob jsonb;
  v_mode text;
begin
  for r in
    select c.id, c.onboarding_pdv
    from public.companies c
    join public.company_integrations ci
      on ci.company_id = c.id
     and ci.provider = 'epoc'
     and ci.enabled = true
    where coalesce(nullif(trim(ci.settings->>'base_url'), ''), '') <> ''
      and not exists (
        select 1 from public.epoc_sync_state s where s.company_id = c.id
      )
    order by c.created_at desc nulls last
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  loop
    v_ob := coalesce(r.onboarding_pdv, '{}'::jsonb);
    if coalesce((v_ob->>'completed')::boolean, false) then
      v_mode := 'steady';
    else
      v_mode := 'onboarding';
    end if;
    -- Steady: agenda para o próximo dia (não dispara todos de imediato no backfill).
    perform public.epoc_sync_ensure_company(
      r.id,
      null,
      v_mode,
      case when v_mode = 'onboarding' then true else false end
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;

grant execute on function public.epoc_sync_backfill_missing_states(int) to service_role;

-- ---------------------------------------------------------------------------
-- Crons: desliga legado e agenda pipeline novo
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'epoc_daily_sync') then
    perform cron.unschedule((select jobid from cron.job where jobname = 'epoc_daily_sync'));
  end if;
  if exists (select 1 from cron.job where jobname = 'epoc_pipeline_dispatcher') then
    perform cron.unschedule((select jobid from cron.job where jobname = 'epoc_pipeline_dispatcher'));
  end if;
  if exists (select 1 from cron.job where jobname = 'epoc_pipeline_worker') then
    perform cron.unschedule((select jobid from cron.job where jobname = 'epoc_pipeline_worker'));
  end if;
end $$;

create or replace function public.cron_invoke_epoc_pipeline_dispatcher()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  base_url text;
  anon_key text;
  bearer text;
  req_id bigint;
begin
  select ds.decrypted_secret into base_url
  from vault.decrypted_secrets ds
  where ds.name = 'focus_interpret_cron_supabase_url'
  limit 1;

  select ds.decrypted_secret into anon_key
  from vault.decrypted_secrets ds
  where ds.name = 'focus_interpret_cron_anon_key'
  limit 1;

  -- Reutiliza o bearer do cron diário legado (= EPOC_DAILY_CRON_SECRET).
  select ds.decrypted_secret into bearer
  from vault.decrypted_secrets ds
  where ds.name = 'epoc_daily_cron_bearer_secret'
  limit 1;

  if base_url is null or length(trim(base_url)) = 0 then
    raise notice 'epoc_pipeline_dispatcher: vault secret focus_interpret_cron_supabase_url em falta.';
    return;
  end if;
  if anon_key is null or length(trim(anon_key)) = 0 then
    raise notice 'epoc_pipeline_dispatcher: vault secret focus_interpret_cron_anon_key em falta.';
    return;
  end if;
  if bearer is null or length(trim(bearer)) = 0 then
    raise notice 'epoc_pipeline_dispatcher: vault secret epoc_daily_cron_bearer_secret em falta.';
    return;
  end if;

  select net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/epoc-dispatcher',
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || bearer,
      'apikey', anon_key
    )
  ) into req_id;

  raise notice 'epoc_pipeline_dispatcher: net.http_post request_id=%', req_id;
end;
$$;

comment on function public.cron_invoke_epoc_pipeline_dispatcher() is
  'pg_cron (1 min): POST epoc-dispatcher — enfileira sync_company para empresas due.';

grant execute on function public.cron_invoke_epoc_pipeline_dispatcher() to postgres;

create or replace function public.cron_invoke_epoc_pipeline_worker()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  base_url text;
  anon_key text;
  bearer text;
  req_id bigint;
begin
  select ds.decrypted_secret into base_url
  from vault.decrypted_secrets ds
  where ds.name = 'focus_interpret_cron_supabase_url'
  limit 1;

  select ds.decrypted_secret into anon_key
  from vault.decrypted_secrets ds
  where ds.name = 'focus_interpret_cron_anon_key'
  limit 1;

  select ds.decrypted_secret into bearer
  from vault.decrypted_secrets ds
  where ds.name = 'epoc_daily_cron_bearer_secret'
  limit 1;

  if base_url is null or length(trim(base_url)) = 0 then
    raise notice 'epoc_pipeline_worker: vault secret focus_interpret_cron_supabase_url em falta.';
    return;
  end if;
  if anon_key is null or length(trim(anon_key)) = 0 then
    raise notice 'epoc_pipeline_worker: vault secret focus_interpret_cron_anon_key em falta.';
    return;
  end if;
  if bearer is null or length(trim(bearer)) = 0 then
    raise notice 'epoc_pipeline_worker: vault secret epoc_daily_cron_bearer_secret em falta.';
    return;
  end if;

  select net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/epoc-worker',
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || bearer,
      'apikey', anon_key
    )
  ) into req_id;

  raise notice 'epoc_pipeline_worker: net.http_post request_id=%', req_id;
end;
$$;

comment on function public.cron_invoke_epoc_pipeline_worker() is
  'pg_cron (1 min): POST epoc-worker — processa jobs da fila Epoc.';

grant execute on function public.cron_invoke_epoc_pipeline_worker() to postgres;

select cron.schedule(
  'epoc_pipeline_dispatcher',
  '* * * * *',
  $cron$select public.cron_invoke_epoc_pipeline_dispatcher();$cron$
);

select cron.schedule(
  'epoc_pipeline_worker',
  '* * * * *',
  $cron$select public.cron_invoke_epoc_pipeline_worker();$cron$
);

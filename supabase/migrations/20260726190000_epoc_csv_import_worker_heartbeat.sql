-- Worker CSV Epoc: heartbeat + token para self-chain e watchdog (órfãos > 2 min).

alter table public.integration_csv_revenue_import_jobs
  add column if not exists processing_started_at timestamptz,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists worker_token uuid;

comment on column public.integration_csv_revenue_import_jobs.processing_started_at is
  'Início do ciclo PROCESSING atual (claim).';
comment on column public.integration_csv_revenue_import_jobs.heartbeat_at is
  'Último sinal de vida do worker; watchdog reclama se > 2 min.';
comment on column public.integration_csv_revenue_import_jobs.worker_token is
  'Token do worker que detém o claim; self-call deve enviar o mesmo.';

create index if not exists integration_csv_revenue_import_jobs_watchdog_idx
  on public.integration_csv_revenue_import_jobs (heartbeat_at)
  where status = 'PROCESSING';

-- Claim / renew / reclaim atómico.
-- p_worker_token: null = novo claim ou reclaim de órfão; uuid = renew do mesmo worker.
-- p_stale_seconds: heartbeat mais velho que isto permite reclaim (default 120).
create or replace function public.epoc_csv_import_claim(
  p_job_id uuid,
  p_worker_token uuid default null,
  p_stale_seconds int default 120
)
returns table (
  job_id uuid,
  worker_token uuid,
  status text,
  csv_resume_row_index int,
  action text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.integration_csv_revenue_import_jobs%rowtype;
  v_token uuid;
  v_stale interval;
  v_action text;
begin
  v_stale := make_interval(secs => greatest(30, least(coalesce(p_stale_seconds, 120), 3600)));

  select * into j
  from public.integration_csv_revenue_import_jobs
  where id = p_job_id
  for update;

  if not found then
    return;
  end if;

  if j.status in ('COMPLETED', 'FAILED') then
    job_id := j.id;
    worker_token := j.worker_token;
    status := j.status;
    csv_resume_row_index := coalesce(j.csv_resume_row_index, 0);
    action := 'terminal';
    return next;
    return;
  end if;

  -- Mesmo worker a renovar.
  if j.status = 'PROCESSING'
    and p_worker_token is not null
    and j.worker_token is not null
    and j.worker_token = p_worker_token
  then
    update public.integration_csv_revenue_import_jobs
    set
      heartbeat_at = now(),
      updated_at = now()
    where id = j.id;

    job_id := j.id;
    worker_token := j.worker_token;
    status := 'PROCESSING';
    csv_resume_row_index := coalesce(j.csv_resume_row_index, 0);
    action := 'renew';
    return next;
    return;
  end if;

  -- Job vivo com outro worker → skip.
  if j.status = 'PROCESSING'
    and j.heartbeat_at is not null
    and j.heartbeat_at > now() - v_stale
    and (p_worker_token is null or j.worker_token is distinct from p_worker_token)
  then
    job_id := j.id;
    worker_token := j.worker_token;
    status := j.status;
    csv_resume_row_index := coalesce(j.csv_resume_row_index, 0);
    action := 'alive';
    return next;
    return;
  end if;

  -- PENDING, ou PROCESSING órfão (heartbeat velho / null), ou token mismatch stale.
  v_token := coalesce(p_worker_token, gen_random_uuid());
  if j.status = 'PENDING' then
    v_action := 'claim';
  else
    v_action := 'reclaim';
  end if;

  update public.integration_csv_revenue_import_jobs
  set
    status = 'PROCESSING',
    worker_token = v_token,
    processing_started_at = case
      when j.status = 'PENDING' or j.processing_started_at is null then now()
      when j.heartbeat_at is null or j.heartbeat_at <= now() - v_stale then now()
      else j.processing_started_at
    end,
    heartbeat_at = now(),
    chunk_lease_expires_at = null,
    updated_at = now()
  where id = j.id;

  job_id := j.id;
  worker_token := v_token;
  status := 'PROCESSING';
  csv_resume_row_index := coalesce(j.csv_resume_row_index, 0);
  action := v_action;
  return next;
end;
$$;

comment on function public.epoc_csv_import_claim(uuid, uuid, int) is
  'Claim/renew/reclaim do import CSV Epoc com heartbeat (stale default 120s).';

grant execute on function public.epoc_csv_import_claim(uuid, uuid, int) to service_role;

create or replace function public.epoc_csv_import_heartbeat(
  p_job_id uuid,
  p_worker_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.integration_csv_revenue_import_jobs
  set
    heartbeat_at = now(),
    updated_at = now()
  where id = p_job_id
    and status = 'PROCESSING'
    and worker_token = p_worker_token;

  return found;
end;
$$;

grant execute on function public.epoc_csv_import_heartbeat(uuid, uuid) to service_role;

create or replace function public.epoc_csv_import_pick_stale(
  p_limit int default 5,
  p_stale_seconds int default 120
)
returns table (job_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select j.id
  from public.integration_csv_revenue_import_jobs j
  where j.status = 'PROCESSING'
    and (
      j.heartbeat_at is null
      or j.heartbeat_at <= now() - make_interval(secs => greatest(30, least(coalesce(p_stale_seconds, 120), 3600)))
    )
  order by coalesce(j.heartbeat_at, j.updated_at) asc nulls first
  limit greatest(1, least(coalesce(p_limit, 5), 20));
end;
$$;

grant execute on function public.epoc_csv_import_pick_stale(int, int) to service_role;

-- Cron watchdog → Edge epoc-csv-import-worker
create or replace function public.cron_invoke_epoc_csv_import_watchdog()
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
    raise notice 'epoc_csv_import_watchdog: vault secret focus_interpret_cron_supabase_url em falta.';
    return;
  end if;
  if anon_key is null or length(trim(anon_key)) = 0 then
    raise notice 'epoc_csv_import_watchdog: vault secret focus_interpret_cron_anon_key em falta.';
    return;
  end if;
  if bearer is null or length(trim(bearer)) = 0 then
    raise notice 'epoc_csv_import_watchdog: vault secret epoc_daily_cron_bearer_secret em falta.';
    return;
  end if;

  select net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/epoc-csv-import-worker',
    body := jsonb_build_object('mode', 'watchdog'),
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || bearer,
      'apikey', anon_key
    )
  ) into req_id;

  raise notice 'epoc_csv_import_watchdog: net.http_post request_id=%', req_id;
end;
$$;

comment on function public.cron_invoke_epoc_csv_import_watchdog() is
  'pg_cron (1 min): POST epoc-csv-import-worker mode=watchdog — retoma imports CSV órfãos.';

grant execute on function public.cron_invoke_epoc_csv_import_watchdog() to postgres;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'epoc_csv_import_watchdog') then
    perform cron.unschedule((select jobid from cron.job where jobname = 'epoc_csv_import_watchdog'));
  end if;
end $$;

select cron.schedule(
  'epoc_csv_import_watchdog',
  '* * * * *',
  $cron$select public.cron_invoke_epoc_csv_import_watchdog();$cron$
);

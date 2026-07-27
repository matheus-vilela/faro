-- Pipeline NF-e Fase 1: fila por jobs (sync → página → download XML → close).
-- Substitui o orquestrador monolítico focus-get-sync-nfe nos crons.
-- XML em Storage (bucket nfe-xml). Onboarding Fase 1: capture_completed (completed só na Fase 2).

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- onboarding_fiscal: capture_completed (Fase 1)
-- ---------------------------------------------------------------------------
alter table public.companies
  alter column onboarding_fiscal set default jsonb_build_object(
    'sync', true,
    'max_nfes_sync', 0,
    'nfes_sync', 0,
    'nfes_ignored', 0,
    'completed', false,
    'capture_completed', false,
    'sefaz_unavailable', false
  );

comment on column public.companies.onboarding_fiscal is
  'Onboarding fiscal: sync, métricas, capture_completed (XMLs baixados), completed (motor Fase 2), sefaz_*.';

update public.companies c
set onboarding_fiscal =
  coalesce(c.onboarding_fiscal, '{}'::jsonb)
  || jsonb_build_object(
    'capture_completed',
    coalesce((c.onboarding_fiscal->>'capture_completed')::boolean, false)
  )
where not (coalesce(c.onboarding_fiscal, '{}'::jsonb) ? 'capture_completed');

-- ---------------------------------------------------------------------------
-- nfe_sync_state
-- ---------------------------------------------------------------------------
create table if not exists public.nfe_sync_state (
  company_id uuid primary key references public.companies (id) on delete cascade,
  mode text not null default 'onboarding'
    check (mode in ('onboarding', 'steady')),
  status text not null default 'idle'
    check (status in ('idle', 'running', 'backoff', 'needs_attention')),
  priority int not null default 0,
  cursor_versao bigint not null default 0,
  pending_cursor_versao bigint,
  window_start_date date not null,
  cycle_id uuid,
  last_success_at timestamptz,
  next_sync_at timestamptz not null default now(),
  running_since timestamptz,
  empty_poll_count int not null default 0,
  listed_count int not null default 0,
  downloaded_count int not null default 0,
  ignored_count int not null default 0,
  failed_count int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists nfe_sync_state_due_idx
  on public.nfe_sync_state (next_sync_at, priority desc)
  where status in ('idle', 'backoff');

create index if not exists nfe_sync_state_mode_priority_idx
  on public.nfe_sync_state (mode, priority desc, next_sync_at);

comment on table public.nfe_sync_state is
  'Estado do pipeline NF-e recebidas (Focus) por empresa: cursor, modo onboarding/steady, agenda.';

alter table public.nfe_sync_state enable row level security;

create policy "nfe_sync_state_select_member"
  on public.nfe_sync_state for select to authenticated
  using (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  );

grant select on public.nfe_sync_state to authenticated;
grant select, insert, update, delete on public.nfe_sync_state to service_role;

-- ---------------------------------------------------------------------------
-- nfe_documents
-- ---------------------------------------------------------------------------
create table if not exists public.nfe_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  chave text not null,
  focus_version bigint,
  situacao text,
  nfe_completa boolean,
  emitente_cnpj text,
  numero text,
  serie text,
  emitted_at timestamptz,
  valor_total numeric,
  xml_storage_path text,
  xml_storage_bucket text not null default 'nfe-xml',
  fetch_status text not null default 'listed'
    check (fetch_status in (
      'listed', 'downloading', 'downloaded', 'ignored', 'failed'
    )),
  process_status text not null default 'pending'
    check (process_status in (
      'pending', 'processing', 'done', 'failed', 'skipped'
    )),
  focus_payload jsonb,
  cycle_id uuid,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, chave)
);

create index if not exists nfe_documents_company_fetch_idx
  on public.nfe_documents (company_id, fetch_status);

create index if not exists nfe_documents_company_process_idx
  on public.nfe_documents (company_id, process_status)
  where process_status in ('pending', 'failed');

create index if not exists nfe_documents_cycle_idx
  on public.nfe_documents (company_id, cycle_id);

comment on table public.nfe_documents is
  'NF-e recebidas: metadados Focus + path do XML no Storage; process_status usado na Fase 2.';

alter table public.nfe_documents enable row level security;

create policy "nfe_documents_select_member"
  on public.nfe_documents for select to authenticated
  using (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  );

grant select on public.nfe_documents to authenticated;
grant select, insert, update, delete on public.nfe_documents to service_role;

-- ---------------------------------------------------------------------------
-- nfe_jobs
-- ---------------------------------------------------------------------------
create table if not exists public.nfe_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null
    check (type in (
      'sync_company', 'fetch_page', 'download_xml', 'close_cycle', 'process_nfe'
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

create index if not exists nfe_jobs_claim_idx
  on public.nfe_jobs (priority desc, run_after, created_at)
  where status = 'queued';

create index if not exists nfe_jobs_company_open_idx
  on public.nfe_jobs (company_id, status)
  where status in ('queued', 'leased');

create unique index if not exists nfe_jobs_uq_sync_company_open
  on public.nfe_jobs (company_id)
  where type = 'sync_company' and status in ('queued', 'leased');

create unique index if not exists nfe_jobs_uq_close_cycle_open
  on public.nfe_jobs (company_id)
  where type = 'close_cycle' and status in ('queued', 'leased');

create unique index if not exists nfe_jobs_uq_fetch_page_open
  on public.nfe_jobs (company_id, (payload->>'versao'))
  where type = 'fetch_page' and status in ('queued', 'leased');

create unique index if not exists nfe_jobs_uq_download_xml_open
  on public.nfe_jobs (company_id, (payload->>'chave'))
  where type = 'download_xml' and status in ('queued', 'leased');

create unique index if not exists nfe_jobs_uq_process_nfe_open
  on public.nfe_jobs (company_id, (payload->>'document_id'))
  where type = 'process_nfe' and status in ('queued', 'leased');

comment on table public.nfe_jobs is
  'Fila do pipeline NF-e: unidades pequenas com lease (SKIP LOCKED).';

alter table public.nfe_jobs enable row level security;

grant select, insert, update, delete on public.nfe_jobs to service_role;

-- ---------------------------------------------------------------------------
-- Storage bucket nfe-xml
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'nfe-xml',
  'nfe-xml',
  false,
  10485760,
  array[
    'application/xml',
    'text/xml',
    'application/octet-stream'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "nfe_xml_select_company" on storage.objects;
drop policy if exists "nfe_xml_insert_company" on storage.objects;
drop policy if exists "nfe_xml_update_company" on storage.objects;
drop policy if exists "nfe_xml_delete_company" on storage.objects;

create policy "nfe_xml_select_company"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'nfe-xml'
    and (storage.foldername(name))[1] in (
      select uc.company_id::text
      from public.user_companies uc
      where uc.user_id = auth.uid()
    )
  );

create policy "nfe_xml_insert_company"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'nfe-xml'
    and (storage.foldername(name))[1] in (
      select uc.company_id::text
      from public.user_companies uc
      where uc.user_id = auth.uid()
    )
  );

create policy "nfe_xml_update_company"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'nfe-xml'
    and (storage.foldername(name))[1] in (
      select uc.company_id::text
      from public.user_companies uc
      where uc.user_id = auth.uid()
    )
  );

create policy "nfe_xml_delete_company"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'nfe-xml'
    and (storage.foldername(name))[1] in (
      select uc.company_id::text
      from public.user_companies uc
      where uc.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Helpers: janela default (1º dia de 2 meses atrás, America/Sao_Paulo)
-- ---------------------------------------------------------------------------
create or replace function public.nfe_default_window_start_date(p_ref date default (timezone('America/Sao_Paulo', now()))::date)
returns date
language plpgsql
immutable
as $$
declare
  y int := extract(year from p_ref)::int;
  m int := extract(month from p_ref)::int;
begin
  m := m - 2;
  while m < 1 loop
    m := m + 12;
    y := y - 1;
  end loop;
  return make_date(y, m, 1);
end;
$$;

comment on function public.nfe_default_window_start_date(date) is
  'Default da janela de recebimento NF-e: 1º dia civil de dois meses atrás (SP).';

-- ---------------------------------------------------------------------------
-- Enqueue / claim / release
-- ---------------------------------------------------------------------------
create or replace function public.nfe_jobs_enqueue(
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
    insert into public.nfe_jobs (type, company_id, payload, priority, run_after, status)
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
  from public.nfe_jobs j
  where j.company_id = p_company_id
    and j.type = p_type
    and j.status in ('queued', 'leased')
    and (
      (p_type in ('sync_company', 'close_cycle'))
      or (p_type = 'fetch_page' and j.payload->>'versao' is not distinct from coalesce(p_payload, '{}'::jsonb)->>'versao')
      or (p_type = 'download_xml' and j.payload->>'chave' is not distinct from coalesce(p_payload, '{}'::jsonb)->>'chave')
      or (p_type = 'process_nfe' and j.payload->>'document_id' is not distinct from coalesce(p_payload, '{}'::jsonb)->>'document_id')
    )
  order by j.created_at
  limit 1;

  return v_id;
end;
$$;

comment on function public.nfe_jobs_enqueue(text, uuid, jsonb, int, timestamptz) is
  'Enfileira job NF-e com dedupe por unique parcial; devolve id novo ou existente aberto.';

grant execute on function public.nfe_jobs_enqueue(text, uuid, jsonb, int, timestamptz) to service_role;

create or replace function public.nfe_jobs_release_expired_leases()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  update public.nfe_jobs
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

grant execute on function public.nfe_jobs_release_expired_leases() to service_role;

create or replace function public.nfe_jobs_claim(
  p_limit int default 5,
  p_worker_id text default 'worker',
  p_lease_seconds int default 180
)
returns setof public.nfe_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.nfe_jobs_release_expired_leases();

  return query
  with picked as (
    select j.id
    from public.nfe_jobs j
    where j.status = 'queued'
      and j.run_after <= now()
    order by j.priority desc, j.run_after asc, j.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 5), 50))
  ),
  updated as (
    update public.nfe_jobs j
    set
      status = 'leased',
      leased_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 180), 600))),
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

comment on function public.nfe_jobs_claim(int, text, int) is
  'Claim atómico de jobs queued (SKIP LOCKED) com lease.';

grant execute on function public.nfe_jobs_claim(int, text, int) to service_role;

create or replace function public.nfe_jobs_complete(
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
  j public.nfe_jobs%rowtype;
begin
  select * into j from public.nfe_jobs where id = p_job_id for update;
  if not found then
    return;
  end if;

  if p_ok then
    update public.nfe_jobs
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
    update public.nfe_jobs
    set
      status = 'dead',
      leased_until = null,
      leased_by = null,
      last_error = left(coalesce(p_error, 'max attempts'), 2000),
      updated_at = now()
    where id = p_job_id;
    return;
  end if;

  update public.nfe_jobs
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

grant execute on function public.nfe_jobs_complete(uuid, boolean, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Ensure / pick companies
-- ---------------------------------------------------------------------------
create or replace function public.nfe_sync_ensure_company(
  p_company_id uuid,
  p_window_start_date date default null,
  p_mode text default null,
  p_wake boolean default true
)
returns public.nfe_sync_state
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.nfe_sync_state%rowtype;
  v_focus jsonb;
  v_ob jsonb;
  v_mode text;
  v_window date;
  v_priority int;
  v_completed boolean;
  v_capture boolean;
begin
  select c.focusnfe, c.onboarding_fiscal
  into v_focus, v_ob
  from public.companies c
  where c.id = p_company_id;

  if not found then
    raise exception 'company not found: %', p_company_id;
  end if;

  if coalesce(nullif(trim(v_focus->>'id_empresa'), ''), '') = '' then
    raise exception 'company sem focusnfe.id_empresa: %', p_company_id;
  end if;

  v_completed := coalesce((v_ob->>'completed')::boolean, false);
  v_capture := coalesce((v_ob->>'capture_completed')::boolean, false);

  if p_mode in ('onboarding', 'steady') then
    v_mode := p_mode;
  elsif v_completed or v_capture then
    v_mode := 'steady';
  else
    v_mode := 'onboarding';
  end if;

  v_window := coalesce(p_window_start_date, public.nfe_default_window_start_date());
  v_priority := case when v_mode = 'onboarding' then 100 else 0 end;

  insert into public.nfe_sync_state (
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
    case when coalesce(p_wake, true) then now() else now() + interval '2 hours' end
  )
  on conflict (company_id) do update set
    mode = case
      when p_mode in ('onboarding', 'steady') then p_mode
      else public.nfe_sync_state.mode
    end,
    window_start_date = coalesce(p_window_start_date, public.nfe_sync_state.window_start_date),
    priority = greatest(
      public.nfe_sync_state.priority,
      case
        when coalesce(p_mode, public.nfe_sync_state.mode) = 'onboarding' then 100
        else public.nfe_sync_state.priority
      end
    ),
    next_sync_at = case
      when coalesce(p_wake, true) then least(public.nfe_sync_state.next_sync_at, now())
      else public.nfe_sync_state.next_sync_at
    end,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.nfe_sync_ensure_company(uuid, date, text, boolean) is
  'Garante nfe_sync_state para empresa com Focus; opcionalmente acorda next_sync_at.';

grant execute on function public.nfe_sync_ensure_company(uuid, date, text, boolean) to service_role;

-- Autoriza membros a acordar sync da própria unidade (UI manual).
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
  if not exists (
    select 1 from public.user_companies uc
    where uc.user_id = auth.uid() and uc.company_id = p_company_id
  ) then
    raise exception 'forbidden';
  end if;
  return public.nfe_sync_ensure_company(p_company_id, p_window_start_date, null, p_wake);
end;
$$;

grant execute on function public.nfe_sync_ensure_company_for_member(uuid, date, boolean) to authenticated;

create or replace function public.nfe_sync_pick_due_companies(p_limit int default 15)
returns table (company_id uuid, mode text, priority int, next_sync_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select s.company_id, s.mode, s.priority, s.next_sync_at
  from public.nfe_sync_state s
  where s.next_sync_at <= now()
    and s.status in ('idle', 'backoff')
    and not exists (
      select 1
      from public.nfe_jobs j
      where j.company_id = s.company_id
        and j.status in ('queued', 'leased')
    )
  order by s.priority desc, s.next_sync_at asc
  limit greatest(1, least(coalesce(p_limit, 15), 100));
end;
$$;

grant execute on function public.nfe_sync_pick_due_companies(int) to service_role;

create or replace function public.nfe_sync_backfill_missing_states(p_limit int default 50)
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
    select c.id, c.onboarding_fiscal
    from public.companies c
    where coalesce(nullif(trim(c.focusnfe->>'id_empresa'), ''), '') <> ''
      and length(regexp_replace(coalesce(c.document, ''), '\D', '', 'g')) = 14
      and not exists (
        select 1 from public.nfe_sync_state s where s.company_id = c.id
      )
    order by c.created_at desc nulls last
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  loop
    v_ob := coalesce(r.onboarding_fiscal, '{}'::jsonb);
    if coalesce((v_ob->>'completed')::boolean, false)
      or coalesce((v_ob->>'capture_completed')::boolean, false)
    then
      v_mode := 'steady';
    else
      v_mode := 'onboarding';
    end if;
    perform public.nfe_sync_ensure_company(r.id, null, v_mode, true);
    n := n + 1;
  end loop;
  return n;
end;
$$;

grant execute on function public.nfe_sync_backfill_missing_states(int) to service_role;

-- ---------------------------------------------------------------------------
-- Crons: desliga legado e agenda pipeline novo
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'focus_get_sync_nfe_recebidas') then
    perform cron.unschedule((select jobid from cron.job where jobname = 'focus_get_sync_nfe_recebidas'));
  end if;
  if exists (select 1 from cron.job where jobname = 'focus_get_sync_nfe_onboarding_retry') then
    perform cron.unschedule((select jobid from cron.job where jobname = 'focus_get_sync_nfe_onboarding_retry'));
  end if;
  if exists (select 1 from cron.job where jobname = 'nfe_pipeline_dispatcher') then
    perform cron.unschedule((select jobid from cron.job where jobname = 'nfe_pipeline_dispatcher'));
  end if;
  if exists (select 1 from cron.job where jobname = 'nfe_pipeline_worker') then
    perform cron.unschedule((select jobid from cron.job where jobname = 'nfe_pipeline_worker'));
  end if;
end $$;

create or replace function public.cron_invoke_nfe_pipeline_dispatcher()
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
  where ds.name = 'focus_interpret_cron_bearer_secret'
  limit 1;

  if base_url is null or length(trim(base_url)) = 0 then
    raise notice 'nfe_pipeline_dispatcher: vault secret focus_interpret_cron_supabase_url em falta.';
    return;
  end if;
  if anon_key is null or length(trim(anon_key)) = 0 then
    raise notice 'nfe_pipeline_dispatcher: vault secret focus_interpret_cron_anon_key em falta.';
    return;
  end if;
  if bearer is null or length(trim(bearer)) = 0 then
    raise notice 'nfe_pipeline_dispatcher: vault secret focus_interpret_cron_bearer_secret em falta.';
    return;
  end if;

  select net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/nfe-dispatcher',
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || bearer,
      'apikey', anon_key
    )
  ) into req_id;

  raise notice 'nfe_pipeline_dispatcher: net.http_post request_id=%', req_id;
end;
$$;

comment on function public.cron_invoke_nfe_pipeline_dispatcher() is
  'pg_cron (1 min): POST nfe-dispatcher — enfileira sync_company para empresas due.';

grant execute on function public.cron_invoke_nfe_pipeline_dispatcher() to postgres;

create or replace function public.cron_invoke_nfe_pipeline_worker()
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
  where ds.name = 'focus_interpret_cron_bearer_secret'
  limit 1;

  if base_url is null or length(trim(base_url)) = 0 then
    raise notice 'nfe_pipeline_worker: vault secret focus_interpret_cron_supabase_url em falta.';
    return;
  end if;
  if anon_key is null or length(trim(anon_key)) = 0 then
    raise notice 'nfe_pipeline_worker: vault secret focus_interpret_cron_anon_key em falta.';
    return;
  end if;
  if bearer is null or length(trim(bearer)) = 0 then
    raise notice 'nfe_pipeline_worker: vault secret focus_interpret_cron_bearer_secret em falta.';
    return;
  end if;

  select net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/nfe-worker',
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || bearer,
      'apikey', anon_key
    )
  ) into req_id;

  raise notice 'nfe_pipeline_worker: net.http_post request_id=%', req_id;
end;
$$;

comment on function public.cron_invoke_nfe_pipeline_worker() is
  'pg_cron (1 min): POST nfe-worker — processa jobs da fila NF-e.';

grant execute on function public.cron_invoke_nfe_pipeline_worker() to postgres;

select cron.schedule(
  'nfe_pipeline_dispatcher',
  '* * * * *',
  $cron$select public.cron_invoke_nfe_pipeline_dispatcher();$cron$
);

select cron.schedule(
  'nfe_pipeline_worker',
  '* * * * *',
  $cron$select public.cron_invoke_nfe_pipeline_worker();$cron$
);

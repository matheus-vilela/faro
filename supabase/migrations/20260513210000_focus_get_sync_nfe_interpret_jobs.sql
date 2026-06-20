-- Fila para interpretar XMLs gravados por `focus-get-sync-nfe` em `focus_get_sync_nfe_staging`.
-- Disparo assíncrono: pg_cron (1 min em teste) chama `net.http_post` → Edge `focus-get-sync-nfe-interpret-staging`.
--
-- Vault (Dashboard → Database → Vault, ou SQL): criar secrets com estes **names** exatos:
--   focus_interpret_cron_supabase_url   → https://<PROJECT_REF>.supabase.co
--   focus_interpret_cron_anon_key       → anon key do projeto
--   focus_interpret_cron_bearer_secret  → mesmo valor que FOCUS_NFE_RECEBIDAS_CRON_SECRET na Edge
--
-- Para produção, alterar o schedule de 1 min para 5 min:
--   SELECT cron.unschedule((SELECT jobid FROM cron.job WHERE jobname = 'focus_get_sync_nfe_interpret_dispatch'));
--   SELECT cron.schedule('focus_get_sync_nfe_interpret_dispatch', '*/5 * * * *', $cron$SELECT public.cron_invoke_focus_get_sync_nfe_interpret();$cron$);

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;

create table if not exists public.focus_get_sync_nfe_interpret_jobs (
  id uuid primary key default gen_random_uuid(),
  exec_id uuid not null,
  company_id uuid not null references public.companies (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (exec_id, company_id)
);

create index if not exists focus_get_sync_nfe_interpret_jobs_pending_idx
  on public.focus_get_sync_nfe_interpret_jobs (status, created_at);

comment on table public.focus_get_sync_nfe_interpret_jobs is
  'Fila pós-sync resumida: pg_cron invoca Edge `focus-get-sync-nfe-interpret-staging` para interpretar XMLs em staging.';

alter table public.focus_get_sync_nfe_interpret_jobs enable row level security;

grant select, insert, update, delete on public.focus_get_sync_nfe_interpret_jobs to service_role;

-- Claim atómico de um job pendente (SKIP LOCKED).
create or replace function public.focus_get_sync_nfe_interpret_claim_job()
returns setof public.focus_get_sync_nfe_interpret_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select id
    from public.focus_get_sync_nfe_interpret_jobs
    where status = 'pending'
    order by created_at
    for update skip locked
    limit 1
  ),
  updated as (
    update public.focus_get_sync_nfe_interpret_jobs j
    set
      status = 'processing',
      started_at = coalesce(j.started_at, now()),
      attempts = j.attempts + 1
    from picked
    where j.id = picked.id
    returning j.*
  )
  select * from updated;
end;
$$;

comment on function public.focus_get_sync_nfe_interpret_claim_job() is
  'Reserva um job pendente para a Edge `focus-get-sync-nfe-interpret-staging` (SKIP LOCKED).';

grant execute on function public.focus_get_sync_nfe_interpret_claim_job() to service_role;

-- Chamada HTTP disparada pelo pg_cron (lê secrets no Vault; se faltar URL, não faz pedido).
create or replace function public.cron_invoke_focus_get_sync_nfe_interpret()
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
    raise notice 'focus_get_sync_nfe_interpret: vault secret focus_interpret_cron_supabase_url em falta; cron sem HTTP.';
    return;
  end if;

  if anon_key is null or length(trim(anon_key)) = 0 then
    raise notice 'focus_get_sync_nfe_interpret: vault secret focus_interpret_cron_anon_key em falta; cron sem HTTP.';
    return;
  end if;

  if bearer is null or length(trim(bearer)) = 0 then
    raise notice 'focus_get_sync_nfe_interpret: vault secret focus_interpret_cron_bearer_secret em falta; cron sem HTTP.';
    return;
  end if;

  -- pg_net: net.http_post(url, body jsonb, params jsonb, headers jsonb, timeout_milliseconds)
  select net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/focus-get-sync-nfe-interpret-staging',
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || bearer,
      'apikey', anon_key
    )
  ) into req_id;

  raise notice 'focus_get_sync_nfe_interpret: net.http_post request_id=%', req_id;
end;
$$;

comment on function public.cron_invoke_focus_get_sync_nfe_interpret() is
  'pg_cron: POST para Edge interpret staging (secrets Vault: focus_interpret_cron_*).';

grant execute on function public.cron_invoke_focus_get_sync_nfe_interpret() to postgres;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'focus_get_sync_nfe_interpret_dispatch') then
    perform cron.unschedule((select jobid from cron.job where jobname = 'focus_get_sync_nfe_interpret_dispatch'));
  end if;
end;
$do$;

-- Teste: a cada 1 minuto. Produção: trocar para */5 * * * * (ver comentário no topo do ficheiro).
select cron.schedule(
  'focus_get_sync_nfe_interpret_dispatch',
  '* * * * *',
  $cron$select public.cron_invoke_focus_get_sync_nfe_interpret();$cron$
);

-- pg_cron: uma unidade por run a cada 10 min → Edge `epoc-daily-sync` (rodízio 12 h na função).
-- Vault (mesmos URL/anon do interpret, bearer = EPOC_DAILY_CRON_SECRET):
--   focus_interpret_cron_supabase_url, focus_interpret_cron_anon_key, epoc_daily_cron_bearer_secret

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create or replace function public.cron_invoke_epoc_daily_sync()
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
    raise notice 'epoc_daily_sync: vault secret focus_interpret_cron_supabase_url em falta.';
    return;
  end if;

  if anon_key is null or length(trim(anon_key)) = 0 then
    raise notice 'epoc_daily_sync: vault secret focus_interpret_cron_anon_key em falta.';
    return;
  end if;

  if bearer is null or length(trim(bearer)) = 0 then
    raise notice 'epoc_daily_sync: vault secret epoc_daily_cron_bearer_secret em falta.';
    return;
  end if;

  select net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/epoc-daily-sync',
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || bearer,
      'apikey', anon_key
    )
  ) into req_id;

  raise notice 'epoc_daily_sync: net.http_post request_id=%', req_id;
end;
$$;

comment on function public.cron_invoke_epoc_daily_sync() is
  'pg_cron (10 min): POST epoc-daily-sync — processa uma unidade EPOC por run (rodízio 12 h). Vault: focus_interpret_cron_supabase_url, focus_interpret_cron_anon_key, epoc_daily_cron_bearer_secret.';

grant execute on function public.cron_invoke_epoc_daily_sync() to postgres;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'epoc_daily_sync') then
    perform cron.unschedule(
      (select jobid from cron.job where jobname = 'epoc_daily_sync')
    );
  end if;
end $$;

select cron.schedule(
  'epoc_daily_sync',
  '*/10 * * * *',
  $cron$select public.cron_invoke_epoc_daily_sync();$cron$
);

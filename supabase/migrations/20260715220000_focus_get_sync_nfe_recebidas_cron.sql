-- pg_cron: listagem regular de NF-e recebidas (Focus) a cada 10 min.
-- A Edge `focus-get-sync-nfe` escolhe no máximo 1 unidade por run (rodízio 12 h)
-- e adia se existir job de interpretação pending/processing.
-- Vault (mesmos secrets do interpret / onboarding retry):
--   focus_interpret_cron_supabase_url
--   focus_interpret_cron_anon_key
--   focus_interpret_cron_bearer_secret  (= FOCUS_NFE_RECEBIDAS_CRON_SECRET nas Edge Functions)

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create or replace function public.cron_invoke_focus_get_sync_nfe_recebidas()
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
    raise notice 'focus_get_sync_nfe_recebidas: vault secret focus_interpret_cron_supabase_url em falta.';
    return;
  end if;

  if anon_key is null or length(trim(anon_key)) = 0 then
    raise notice 'focus_get_sync_nfe_recebidas: vault secret focus_interpret_cron_anon_key em falta.';
    return;
  end if;

  if bearer is null or length(trim(bearer)) = 0 then
    raise notice 'focus_get_sync_nfe_recebidas: vault secret focus_interpret_cron_bearer_secret em falta.';
    return;
  end if;

  select net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/focus-get-sync-nfe',
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || bearer,
      'apikey', anon_key
    )
  ) into req_id;

  raise notice 'focus_get_sync_nfe_recebidas: net.http_post request_id=%', req_id;
end;
$$;

comment on function public.cron_invoke_focus_get_sync_nfe_recebidas() is
  'pg_cron (10 min): POST focus-get-sync-nfe — listagem NF-e recebidas; 1 unidade/run, intervalo 12 h na Edge.';

grant execute on function public.cron_invoke_focus_get_sync_nfe_recebidas() to postgres;

do $$
begin
  if exists (
    select 1 from cron.job where jobname = 'focus_get_sync_nfe_recebidas'
  ) then
    perform cron.unschedule(
      (select jobid from cron.job where jobname = 'focus_get_sync_nfe_recebidas')
    );
  end if;
end $$;

select cron.schedule(
  'focus_get_sync_nfe_recebidas',
  '*/10 * * * *',
  $cron$select public.cron_invoke_focus_get_sync_nfe_recebidas();$cron$
);

-- Interpretação de XML: passar de 1 min (teste) para 5 min (produção).
do $$
begin
  if exists (
    select 1 from cron.job where jobname = 'focus_get_sync_nfe_interpret_dispatch'
  ) then
    perform cron.unschedule(
      (select jobid from cron.job where jobname = 'focus_get_sync_nfe_interpret_dispatch')
    );
  end if;
end $$;

select cron.schedule(
  'focus_get_sync_nfe_interpret_dispatch',
  '*/5 * * * *',
  $cron$select public.cron_invoke_focus_get_sync_nfe_interpret();$cron$
);

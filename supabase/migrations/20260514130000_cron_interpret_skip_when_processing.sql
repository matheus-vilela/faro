-- Cron: não dispara HTTP para interpret staging enquanto existir job em `processing`
-- (evita invocações paralelas ao encadeamento waitUntil + continue_job_id).

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

  if exists (
    select 1
    from public.focus_get_sync_nfe_interpret_jobs j
    where j.status = 'processing'
    limit 1
  ) then
    raise notice 'focus_get_sync_nfe_interpret: existe job em processing; cron não dispara HTTP.';
    return;
  end if;

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
  'pg_cron: POST para Edge interpret staging (Vault: focus_interpret_cron_*). Não chama HTTP se existir job em processing.';

grant execute on function public.cron_invoke_focus_get_sync_nfe_interpret() to postgres;

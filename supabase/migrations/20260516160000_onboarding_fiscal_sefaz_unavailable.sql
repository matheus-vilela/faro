-- Indisponibilidade SEFAZ/Focus no onboarding fiscal + retry automático (30 min).

alter table public.companies
  alter column onboarding_fiscal set default jsonb_build_object(
    'sync', true,
    'max_nfes_sync', 0,
    'nfes_sync', 0,
    'nfes_ignored', 0,
    'completed', false,
    'sefaz_unavailable', false
  );

comment on column public.companies.onboarding_fiscal is
  'Onboarding fiscal: sync, max_nfes_sync, nfes_sync, nfes_ignored, completed, sefaz_unavailable, sefaz_unavailable_at, sefaz_retry_at (retry automático).';

-- pg_cron: re-dispara focus-get-sync-nfe (onboarding) para unidades em erro SEFAZ.
create or replace function public.cron_invoke_focus_get_sync_nfe_onboarding_retry()
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
  r record;
  dispatched int := 0;
  max_per_run int := 5;
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
    raise notice 'focus_get_sync_nfe_onboarding_retry: vault secret focus_interpret_cron_supabase_url em falta.';
    return;
  end if;

  if anon_key is null or length(trim(anon_key)) = 0 then
    raise notice 'focus_get_sync_nfe_onboarding_retry: vault secret focus_interpret_cron_anon_key em falta.';
    return;
  end if;

  if bearer is null or length(trim(bearer)) = 0 then
    raise notice 'focus_get_sync_nfe_onboarding_retry: vault secret focus_interpret_cron_bearer_secret em falta.';
    return;
  end if;

  for r in
    select c.id
    from public.companies c
    where coalesce(c.onboarding_fiscal->>'sefaz_unavailable', 'false') = 'true'
      and coalesce(c.onboarding_fiscal->>'completed', 'false') <> 'true'
      and coalesce(c.onboarding_fiscal->>'sync', 'true') <> 'false'
      and (
        c.onboarding_fiscal->>'sefaz_retry_at' is null
        or (c.onboarding_fiscal->>'sefaz_retry_at')::timestamptz <= now()
      )
      and coalesce(c.focusnfe->>'id_empresa', '') <> ''
      and length(regexp_replace(coalesce(c.document, ''), '\D', '', 'g')) = 14
    order by (c.onboarding_fiscal->>'sefaz_retry_at')::timestamptz nulls first
    limit max_per_run
  loop
    select net.http_post(
      url := rtrim(base_url, '/') || '/functions/v1/focus-get-sync-nfe',
      body := jsonb_build_object(
        'onboarding', true,
        'onboarding_retry', true,
        'company_id', r.id
      ),
      params := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || bearer,
        'apikey', anon_key
      )
    ) into req_id;

    dispatched := dispatched + 1;
    raise notice 'focus_get_sync_nfe_onboarding_retry: company_id=% request_id=%', r.id, req_id;
  end loop;

  if dispatched = 0 then
    raise notice 'focus_get_sync_nfe_onboarding_retry: nenhuma unidade elegível.';
  end if;
end;
$$;

comment on function public.cron_invoke_focus_get_sync_nfe_onboarding_retry() is
  'pg_cron (30 min): POST focus-get-sync-nfe com onboarding_retry para empresas com sefaz_unavailable e sefaz_retry_at vencido.';

grant execute on function public.cron_invoke_focus_get_sync_nfe_onboarding_retry() to postgres;

do $$
begin
  if exists (
    select 1 from cron.job where jobname = 'focus_get_sync_nfe_onboarding_retry'
  ) then
    perform cron.unschedule(
      (select jobid from cron.job where jobname = 'focus_get_sync_nfe_onboarding_retry')
    );
  end if;
end $$;

select cron.schedule(
  'focus_get_sync_nfe_onboarding_retry',
  '*/30 * * * *',
  $cron$select public.cron_invoke_focus_get_sync_nfe_onboarding_retry();$cron$
);

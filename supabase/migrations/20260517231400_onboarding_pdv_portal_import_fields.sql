-- Campos de portal e import no onboarding PDV (card do dashboard só lê `onboarding_pdv`).

UPDATE public.companies c
SET onboarding_pdv = coalesce(c.onboarding_pdv, '{}'::jsonb) || jsonb_build_object(
  'portal_busy', false,
  'portal_outcome', null,
  'portal_message', null,
  'import_status', null,
  'import_error', null
)
WHERE NOT (coalesce(c.onboarding_pdv, '{}'::jsonb) ? 'portal_busy');

ALTER TABLE public.companies
  ALTER COLUMN onboarding_pdv SET DEFAULT jsonb_build_object(
    'completed', false,
    'sync', false,
    'sales_total', 0,
    'sales_sync', 0,
    'portal_busy', false,
    'portal_outcome', null,
    'portal_message', null,
    'import_status', null,
    'import_error', null
  );

COMMENT ON COLUMN public.companies.onboarding_pdv IS
  'Onboarding PDV/EPOC: completed, sync, portal_busy/outcome/message (epoc-sync-csv), sales_total/sales_sync e import_status/import_error (process-integration-csv-revenue-job).';

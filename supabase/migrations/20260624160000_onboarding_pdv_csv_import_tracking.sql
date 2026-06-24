-- Rastreio do job/path CSV no onboarding PDV (recuperação quando a fila fica órfã).

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
    'import_error', null,
    'csv_import_job_id', null,
    'csv_storage_path', null,
    'import_started_at', null
  );

COMMENT ON COLUMN public.companies.onboarding_pdv IS
  'Onboarding PDV/EPOC: completed, sync, portal_*, sales_*, import_*, csv_import_job_id e csv_storage_path (rastreio/recuperação do import CSV).';

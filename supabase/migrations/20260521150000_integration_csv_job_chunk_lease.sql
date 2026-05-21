-- Evita duas invocações paralelas do mesmo offset do CSV (webhook + resume duplo).

ALTER TABLE public.integration_csv_revenue_import_jobs
  ADD COLUMN IF NOT EXISTS chunk_lease_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN public.integration_csv_revenue_import_jobs.chunk_lease_expires_at IS
  'Lease por chunk: enquanto preenchido e no futuro, outra invocação não processa o mesmo csv_resume_row_index.';

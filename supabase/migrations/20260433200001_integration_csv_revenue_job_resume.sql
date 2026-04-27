-- Retomada de processamento do CSV em varias invocacoes da edge (cursor + encadeamento waitUntil).

ALTER TABLE public.integration_csv_revenue_import_jobs
  ADD COLUMN IF NOT EXISTS csv_resume_row_index INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.integration_csv_revenue_import_jobs.csv_resume_row_index IS
  'Indice da proxima linha de dados no CSV (0 = primeira linha apos cabecalho); usado para continuar entre invocacoes.';

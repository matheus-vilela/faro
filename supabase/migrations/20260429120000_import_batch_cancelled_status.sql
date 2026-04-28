-- Permite cancelar lote em fila ou em processamento.

ALTER TABLE public.import_job_batches
  DROP CONSTRAINT IF EXISTS import_job_batches_status_check;

ALTER TABLE public.import_job_batches
  ADD CONSTRAINT import_job_batches_status_check
  CHECK (status IN (
    'QUEUED',
    'PROCESSING',
    'COMPLETED',
    'FAILED',
    'PARTIAL_SUCCESS',
    'COMPLETED_WITH_PENDING_REVIEW',
    'CANCELLED'
  ));

ALTER TABLE public.import_job_files
  DROP CONSTRAINT IF EXISTS import_job_files_status_check;

ALTER TABLE public.import_job_files
  ADD CONSTRAINT import_job_files_status_check
  CHECK (status IN (
    'QUEUED',
    'PROCESSING',
    'COMPLETED',
    'FAILED',
    'PARTIAL_SUCCESS',
    'COMPLETED_WITH_PENDING_REVIEW',
    'CANCELLED'
  ));

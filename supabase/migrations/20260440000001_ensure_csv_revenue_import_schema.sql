-- Reparacao idempotente: garante tabelas/objetos do import CSV de receitas (EPOC).
-- Aplica-se mesmo se migracoes 20260433000010 / 20260433100001 / 20260433200001
-- nao tiverem corrido no projeto remoto (ex.: schema cache sem company_revenue_integration_import_batches).

-- ---------------------------------------------------------------------------
-- Lotes de import (company_revenue_integration_import_batches)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_revenue_integration_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  reference_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  revenue_entry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_revenue_import_batches_company_provider_date
  ON public.company_revenue_integration_import_batches (company_id, provider, reference_date DESC);

COMMENT ON TABLE public.company_revenue_integration_import_batches IS
  'Controlo de execucoes de import automatico de receitas: um registro por lote (ex.: um dia de referencia). provider alinha-se a company_integrations.provider.';

COMMENT ON COLUMN public.company_revenue_integration_import_batches.reference_date IS
  'Dia de negocio ao qual o bloco importado se refere.';

ALTER TABLE public.revenue_entries
  ADD COLUMN IF NOT EXISTS integration_import_batch_id UUID
  REFERENCES public.company_revenue_integration_import_batches(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.revenue_entries.integration_import_batch_id IS
  'Lote de importacao automatico que originou o lancamento, quando aplicavel.';

CREATE INDEX IF NOT EXISTS idx_revenue_entries_integration_import_batch_id
  ON public.revenue_entries (integration_import_batch_id)
  WHERE integration_import_batch_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.revenue_entries_bump_integration_import_batch_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.company_revenue_integration_import_batches
  SET revenue_entry_count = revenue_entry_count + 1,
      updated_at = NOW()
  WHERE id = NEW.integration_import_batch_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_revenue_entries_bump_integration_import_batch ON public.revenue_entries;
CREATE TRIGGER tr_revenue_entries_bump_integration_import_batch
  AFTER INSERT ON public.revenue_entries
  FOR EACH ROW
  WHEN (NEW.integration_import_batch_id IS NOT NULL)
  EXECUTE FUNCTION public.revenue_entries_bump_integration_import_batch_count();

ALTER TABLE public.company_revenue_integration_import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage company revenue integration import batches"
  ON public.company_revenue_integration_import_batches;
CREATE POLICY "Users can manage company revenue integration import batches"
  ON public.company_revenue_integration_import_batches
  FOR ALL
  USING (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  );

GRANT ALL ON public.company_revenue_integration_import_batches TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fila de jobs (integration_csv_revenue_import_jobs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.integration_csv_revenue_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL DEFAULT 'epoc',
  storage_bucket TEXT NOT NULL DEFAULT 'company-setup',
  storage_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_csv_revenue_jobs_company_created
  ON public.integration_csv_revenue_import_jobs (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_integration_csv_revenue_jobs_status
  ON public.integration_csv_revenue_import_jobs (status, created_at ASC)
  WHERE status IN ('PENDING', 'PROCESSING');

COMMENT ON TABLE public.integration_csv_revenue_import_jobs IS
  'Job enfileirado apos export CSV (ex. EPOC); edge process-integration-csv-revenue-job.';

ALTER TABLE public.integration_csv_revenue_import_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage integration csv revenue import jobs in their company"
  ON public.integration_csv_revenue_import_jobs;
CREATE POLICY "Users can manage integration csv revenue import jobs in their company"
  ON public.integration_csv_revenue_import_jobs
  FOR ALL
  USING (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  );

GRANT ALL ON public.integration_csv_revenue_import_jobs TO authenticated, service_role;

ALTER TABLE public.integration_csv_revenue_import_jobs
  ADD COLUMN IF NOT EXISTS csv_resume_row_index INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.integration_csv_revenue_import_jobs.csv_resume_row_index IS
  'Indice da proxima linha de dados no CSV (0 = primeira linha apos cabecalho); retomada entre invocacoes.';

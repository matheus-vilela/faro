-- Histórico de tentativas de export EPOC → CSV (inclui casos sem #tblExport / sem receitas na data).

CREATE TABLE IF NOT EXISTS public.epoc_csv_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL DEFAULT 'epoc',
  sync_mode TEXT NOT NULL,
  outcome TEXT NOT NULL
    CHECK (outcome IN ('no_tbl_export', 'success', 'failed')),
  summary TEXT NOT NULL,
  dates_consulted JSONB NOT NULL DEFAULT '[]'::jsonb,
  steps_prefix TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_epoc_csv_sync_runs_company_created
  ON public.epoc_csv_sync_runs (company_id, created_at DESC);

COMMENT ON TABLE public.epoc_csv_sync_runs IS
  'Registo de cada tentativa de sync EPOC (CSV); outcome no_tbl_export = portal sem #tblExport na janela (ex. dia sem receitas).';

ALTER TABLE public.epoc_csv_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view epoc csv sync runs in their company"
  ON public.epoc_csv_sync_runs;
CREATE POLICY "Users can view epoc csv sync runs in their company"
  ON public.epoc_csv_sync_runs
  FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  );

GRANT SELECT ON public.epoc_csv_sync_runs TO authenticated;
GRANT ALL ON public.epoc_csv_sync_runs TO service_role;

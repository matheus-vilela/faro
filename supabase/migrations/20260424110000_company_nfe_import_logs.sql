CREATE TABLE IF NOT EXISTS public.company_nfe_import_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  xml_hash TEXT NOT NULL,
  nfe_access_key TEXT,
  invoice_number TEXT,
  invoice_series TEXT,
  supplier_document TEXT,
  emission_date DATE,
  status TEXT NOT NULL CHECK (
    status IN ('success', 'duplicate', 'read_error', 'validation_error', 'needs_review')
  ),
  error_message TEXT,
  expense_id UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.company_nfe_import_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own company nfe logs"
  ON public.company_nfe_import_logs;
CREATE POLICY "Users can manage own company nfe logs"
  ON public.company_nfe_import_logs
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_nfe_import_logs_unique_access_key
  ON public.company_nfe_import_logs(company_id, nfe_access_key)
  WHERE nfe_access_key IS NOT NULL AND btrim(nfe_access_key) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_nfe_import_logs_unique_xml_hash
  ON public.company_nfe_import_logs(company_id, xml_hash);

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_nfe_import_logs_unique_fallback
  ON public.company_nfe_import_logs(
    company_id,
    COALESCE(supplier_document, ''),
    COALESCE(invoice_number, ''),
    COALESCE(invoice_series, ''),
    emission_date
  )
  WHERE invoice_number IS NOT NULL
    AND btrim(invoice_number) <> ''
    AND supplier_document IS NOT NULL
    AND btrim(supplier_document) <> ''
    AND emission_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_company_nfe_import_logs_company_created
  ON public.company_nfe_import_logs(company_id, created_at DESC);

GRANT ALL ON public.company_nfe_import_logs TO authenticated, service_role;

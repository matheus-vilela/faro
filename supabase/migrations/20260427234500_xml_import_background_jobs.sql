-- Jobs assíncronos para importação XML/ZIP + pendências operacionais.

CREATE TABLE IF NOT EXISTS public.import_job_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source_file_name TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'PARTIAL_SUCCESS', 'COMPLETED_WITH_PENDING_REVIEW')),
  total_files INTEGER NOT NULL DEFAULT 0,
  processed_files INTEGER NOT NULL DEFAULT 0,
  success_files INTEGER NOT NULL DEFAULT 0,
  failed_files INTEGER NOT NULL DEFAULT 0,
  pending_review_files INTEGER NOT NULL DEFAULT 0,
  progress_percent NUMERIC(6, 2) NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_job_batches_company_created
  ON public.import_job_batches(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.import_job_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.import_job_batches(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  xml_hash TEXT NOT NULL,
  xml_content_base64 TEXT NOT NULL,
  nfe_access_key TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'PARTIAL_SUCCESS', 'COMPLETED_WITH_PENDING_REVIEW')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, xml_hash)
);

CREATE INDEX IF NOT EXISTS idx_import_job_files_batch
  ON public.import_job_files(batch_id, created_at ASC);

CREATE TABLE IF NOT EXISTS public.import_job_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.import_job_batches(id) ON DELETE CASCADE,
  file_id UUID NOT NULL REFERENCES public.import_job_files(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  item_index INTEGER NOT NULL DEFAULT 0,
  product_name TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'PENDING_REVIEW')),
  classification_type TEXT
    CHECK (classification_type IS NULL OR classification_type IN (
      'INSUMO', 'PRODUTO_ESTOCAVEL', 'BEBIDA_REVENDA', 'ITEM_OPERACIONAL', 'NAO_ESTOCAVEL', 'ATIVO_EQUIPAMENTO', 'REVISAO_PENDENTE'
    )),
  pending_reason TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_job_items_file
  ON public.import_job_items(file_id, item_index);

CREATE TABLE IF NOT EXISTS public.import_job_timeline (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.import_job_batches(id) ON DELETE CASCADE,
  file_id UUID REFERENCES public.import_job_files(id) ON DELETE CASCADE,
  stage TEXT NOT NULL
    CHECK (stage IN ('UPLOAD', 'PARSE', 'VALIDATE', 'UPSERT_PRODUCT', 'UPSERT_EXPENSE', 'GENERATE_PENDINGS', 'DONE', 'ERROR')),
  message TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_job_timeline_batch
  ON public.import_job_timeline(batch_id, created_at ASC);

CREATE TABLE IF NOT EXISTS public.import_review_pending (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES public.import_job_batches(id) ON DELETE CASCADE,
  file_id UUID REFERENCES public.import_job_files(id) ON DELETE CASCADE,
  expense_id UUID REFERENCES public.expenses(id) ON DELETE CASCADE,
  expense_item_id UUID REFERENCES public.expense_items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN ('missing_conversion', 'missing_category', 'unit_conflict', 'possible_duplicate', 'missing_product_match')),
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'RESOLVED', 'IGNORED')),
  title TEXT NOT NULL,
  detail TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_review_pending_company_status
  ON public.import_review_pending(company_id, status, created_at DESC);

ALTER TABLE public.company_nfe_import_logs
  ADD COLUMN IF NOT EXISTS import_job_batch_id UUID REFERENCES public.import_job_batches(id) ON DELETE SET NULL;

ALTER TABLE public.company_nfe_import_logs
  ADD COLUMN IF NOT EXISTS import_job_file_id UUID REFERENCES public.import_job_files(id) ON DELETE SET NULL;

ALTER TABLE public.company_alerts
  DROP CONSTRAINT IF EXISTS company_alerts_kind_check;

ALTER TABLE public.company_alerts
  ADD CONSTRAINT company_alerts_kind_check
  CHECK (
    kind IN (
      'low_stock',
      'expense_no_boleto',
      'recebimento_falta',
      'boleto_vencimento_d3',
      'boleto_vencimento_d1',
      'import_pending_review'
    )
  );

ALTER TABLE public.import_job_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_job_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_job_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_job_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_review_pending ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage import job batches in their company"
  ON public.import_job_batches FOR ALL
  USING (company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()))
  WITH CHECK (company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage import job files in their company"
  ON public.import_job_files FOR ALL
  USING (company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()))
  WITH CHECK (company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage import job items in their company"
  ON public.import_job_items FOR ALL
  USING (company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()))
  WITH CHECK (company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage import job timeline in their company"
  ON public.import_job_timeline FOR ALL
  USING (batch_id IN (
    SELECT b.id FROM public.import_job_batches b
    WHERE b.company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  ))
  WITH CHECK (batch_id IN (
    SELECT b.id FROM public.import_job_batches b
    WHERE b.company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  ));

CREATE POLICY "Users can manage import review pending in their company"
  ON public.import_review_pending FOR ALL
  USING (company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()))
  WITH CHECK (company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()));

GRANT ALL ON public.import_job_batches TO authenticated;
GRANT ALL ON public.import_job_files TO authenticated;
GRANT ALL ON public.import_job_items TO authenticated;
GRANT ALL ON public.import_job_timeline TO authenticated;
GRANT ALL ON public.import_review_pending TO authenticated;

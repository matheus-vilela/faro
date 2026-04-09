-- Importação de nota / WhatsApp: unidades, deduplicação, equivalências e status por linha

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS canonical_name TEXT,
  ADD COLUMN IF NOT EXISTS ncm TEXT;

COMMENT ON COLUMN public.products.canonical_name IS
  'Nome normalizado para deduplicação na importação (opcional; preenchido ao criar via nota).';
COMMENT ON COLUMN public.products.ncm IS
  'NCM opcional para sinal de correspondência na importação.';

CREATE INDEX IF NOT EXISTS idx_products_company_canonical
  ON public.products (company_id, canonical_name)
  WHERE canonical_name IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.company_product_import_settings (
  company_id UUID PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  auto_match_min_score SMALLINT NOT NULL DEFAULT 92 CHECK (auto_match_min_score BETWEEN 0 AND 100),
  confirm_min_score SMALLINT NOT NULL DEFAULT 80 CHECK (confirm_min_score BETWEEN 0 AND 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_import_scores_order CHECK (confirm_min_score <= auto_match_min_score)
);

COMMENT ON TABLE public.company_product_import_settings IS
  'Limiares por empresa para auto-match e confirmação na importação de produtos (nota/WhatsApp).';

ALTER TABLE public.company_product_import_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company members manage import settings" ON public.company_product_import_settings;

CREATE POLICY "Company members manage import settings"
  ON public.company_product_import_settings FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

GRANT ALL ON public.company_product_import_settings TO authenticated;

CREATE TABLE IF NOT EXISTS public.product_import_equivalences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  source_canonical_name TEXT NOT NULL,
  source_unit_normalized TEXT NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  dest_unit_normalized TEXT,
  conversion_factor NUMERIC(18, 8),
  requires_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
  invoice_ncm TEXT,
  invoice_ean TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, source_canonical_name, source_unit_normalized)
);

COMMENT ON TABLE public.product_import_equivalences IS
  'Equivalências aprovadas manualmente: rótulo/unidade da nota → produto do cadastro.';

CREATE INDEX IF NOT EXISTS idx_product_import_equiv_company
  ON public.product_import_equivalences (company_id);

ALTER TABLE public.product_import_equivalences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company members manage import equivalences" ON public.product_import_equivalences;

CREATE POLICY "Company members manage import equivalences"
  ON public.product_import_equivalences FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

GRANT ALL ON public.product_import_equivalences TO authenticated;

ALTER TABLE public.expense_items
  ADD COLUMN IF NOT EXISTS import_resolution_status TEXT,
  ADD COLUMN IF NOT EXISTS invoice_unit TEXT,
  ADD COLUMN IF NOT EXISTS ncm TEXT,
  ADD COLUMN IF NOT EXISTS ean TEXT,
  ADD COLUMN IF NOT EXISTS match_score NUMERIC(6, 2),
  ADD COLUMN IF NOT EXISTS match_decision_reason TEXT;

COMMENT ON COLUMN public.expense_items.import_resolution_status IS
  'AUTO_MATCH | PENDING_USER_CONFIRM | UNIT_CONFLICT_PENDING | NEW_PRODUCT_STAGED | USER_CONFIRMED_MATCH | NEW_PRODUCT_CREATED';

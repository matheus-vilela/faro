-- Regras de conversão por produto, log de resolução por linha, colunas de estoque na despesa

ALTER TABLE public.company_product_import_settings
  ADD COLUMN IF NOT EXISTS auto_apply_global_mass_volume BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.company_product_import_settings.auto_apply_global_mass_volume IS
  'Se true, converte automaticamente G↔KG e mL↔L quando o cadastro estiver na unidade base da família.';

CREATE TABLE IF NOT EXISTS public.product_unit_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  from_unit_normalized TEXT NOT NULL,
  to_unit_normalized TEXT NOT NULL,
  conversion_factor NUMERIC(18, 8) NOT NULL CHECK (conversion_factor > 0),
  auto_apply BOOLEAN NOT NULL DEFAULT FALSE,
  requires_confirmation BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, product_id, from_unit_normalized)
);

COMMENT ON TABLE public.product_unit_rules IS
  'Conversão explícita: quantidade em to_unit = quantidade_em_from_unit × conversion_factor (ex.: 1 SACHE → 0,5 KG → factor 0,5).';

COMMENT ON COLUMN public.product_unit_rules.conversion_factor IS
  'Multiplicador: qty_destino = qty_origem × conversion_factor.';

CREATE INDEX IF NOT EXISTS idx_product_unit_rules_company_product
  ON public.product_unit_rules (company_id, product_id);

ALTER TABLE public.product_unit_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company members manage product unit rules" ON public.product_unit_rules;

CREATE POLICY "Company members manage product unit rules"
  ON public.product_unit_rules FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

GRANT ALL ON public.product_unit_rules TO authenticated;

ALTER TABLE public.expense_items
  ADD COLUMN IF NOT EXISTS stock_quantity NUMERIC(14, 6),
  ADD COLUMN IF NOT EXISTS conversion_factor_applied NUMERIC(18, 8),
  ADD COLUMN IF NOT EXISTS resolution_source TEXT,
  ADD COLUMN IF NOT EXISTS normalized_invoice_unit TEXT;

COMMENT ON COLUMN public.expense_items.stock_quantity IS
  'Quantidade já expressa na unidade padrão do produto (estoque), após conversão quando houver.';
COMMENT ON COLUMN public.expense_items.resolution_source IS
  'DIRECT_UNIT_MATCH | AUTO_CONVERTED_GLOBAL_RULE | AUTO_CONVERTED_PRODUCT_RULE | …';

CREATE TABLE IF NOT EXISTS public.expense_resolution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  expense_item_id UUID NOT NULL REFERENCES public.expense_items(id) ON DELETE CASCADE,
  source_item_text TEXT,
  canonical_name TEXT,
  matched_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  input_quantity NUMERIC(18, 6) NOT NULL,
  input_unit_raw TEXT,
  input_unit_normalized TEXT,
  output_quantity NUMERIC(18, 6),
  output_unit_normalized TEXT,
  conversion_factor NUMERIC(18, 8),
  resolution_type TEXT,
  resolution_source TEXT,
  confidence_score NUMERIC(6, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expense_resolution_logs_expense
  ON public.expense_resolution_logs (expense_id);

ALTER TABLE public.expense_resolution_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Company members read expense resolution logs" ON public.expense_resolution_logs;
DROP POLICY IF EXISTS "Company members insert expense resolution logs" ON public.expense_resolution_logs;

CREATE POLICY "Company members read expense resolution logs"
  ON public.expense_resolution_logs FOR SELECT
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

CREATE POLICY "Company members insert expense resolution logs"
  ON public.expense_resolution_logs FOR INSERT
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

GRANT SELECT, INSERT ON public.expense_resolution_logs TO authenticated;

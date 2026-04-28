-- Fase A/B: IA em faixa borderline, adiar criação de produto, vínculo raw ↔ expense_item.

ALTER TABLE public.company_product_import_settings
  ADD COLUMN IF NOT EXISTS llm_borderline_match_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.company_product_import_settings.llm_borderline_match_enabled IS
  'Quando true, usa LLM só na faixa confirm_min_score ≤ score < auto_match_min_score para escolher entre top-K produtos ou novo.';

ALTER TABLE public.company_product_import_settings
  ADD COLUMN IF NOT EXISTS defer_product_creation_to_reconciliation BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.company_product_import_settings.defer_product_creation_to_reconciliation IS
  'Quando true, a importação não chama findOrCreateProduct; produto fica para reconciliação/agrupamento (Phase B).';

ALTER TABLE public.onboarding_import_item_raw
  ADD COLUMN IF NOT EXISTS expense_item_id UUID REFERENCES public.expense_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_onboarding_raw_expense_item
  ON public.onboarding_import_item_raw(expense_item_id)
  WHERE expense_item_id IS NOT NULL;

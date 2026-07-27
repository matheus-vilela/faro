-- Orçamento por categoria e período (mês/ano) para comparação com realizado.

CREATE TABLE IF NOT EXISTS public.company_category_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.company_categories(id) ON DELETE CASCADE,
  year SMALLINT NOT NULL CHECK (year >= 2000 AND year <= 2100),
  month SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_category_budgets_unique UNIQUE (company_id, category_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_company_category_budgets_company_period
  ON public.company_category_budgets(company_id, year, month);

CREATE INDEX IF NOT EXISTS idx_company_category_budgets_category
  ON public.company_category_budgets(category_id);

COMMENT ON TABLE public.company_category_budgets IS
  'Meta de orçamento por folha de categoria e mês; comparação com despesas realizadas.';

ALTER TABLE public.company_category_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Company users read category budgets"
  ON public.company_category_budgets FOR SELECT
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

CREATE POLICY "Company users manage category budgets"
  ON public.company_category_budgets FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

GRANT ALL ON public.company_category_budgets TO authenticated;
GRANT ALL ON public.company_category_budgets TO service_role;

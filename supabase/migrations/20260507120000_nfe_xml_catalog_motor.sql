-- Ledger idempotente do motor de catálogo NF-e por linha (XML ↔ despesa).

CREATE TABLE IF NOT EXISTS public.expense_xml_item_motor_pass (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  expense_item_id UUID REFERENCES public.expense_items(id) ON DELETE SET NULL,
  xml_line_identity TEXT NOT NULL,
  motor_version TEXT NOT NULL,
  outcome JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, expense_id, xml_line_identity, motor_version)
);

COMMENT ON TABLE public.expense_xml_item_motor_pass IS
  'Resultado idempotente do motor de vínculo de produtos NF-e (XML ↔ linha de despesa).';

CREATE INDEX IF NOT EXISTS idx_expense_xml_motor_pass_company_expense
  ON public.expense_xml_item_motor_pass (company_id, expense_id);

ALTER TABLE public.expense_xml_item_motor_pass ENABLE ROW LEVEL SECURITY;

-- Service role + membros da empresa (leitura/auditoria no app).
DROP POLICY IF EXISTS "Company members read xml motor pass" ON public.expense_xml_item_motor_pass;
CREATE POLICY "Company members read xml motor pass"
  ON public.expense_xml_item_motor_pass FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  );

GRANT SELECT ON public.expense_xml_item_motor_pass TO authenticated;
GRANT ALL ON public.expense_xml_item_motor_pass TO service_role;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS financial_reconciliation_json JSONB;

COMMENT ON COLUMN public.expenses.financial_reconciliation_json IS
  'Snapshot estruturado da reconciliação NF-e (totais XML vs linhas, frete, descontos, outros).';

-- Snapshot das saídas de estoque EPOC do dia, gravado junto com a venda de produtos.

CREATE TABLE IF NOT EXISTS public.epoc_day_stock_outs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  sale_date DATE NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  qty NUMERIC(14, 4),
  unit TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, sale_date, sku, name)
);

CREATE INDEX IF NOT EXISTS idx_epoc_day_stock_outs_company_date
  ON public.epoc_day_stock_outs (company_id, sale_date);

COMMENT ON TABLE public.epoc_day_stock_outs IS
  'Saídas de mod_rel_estoque persistidas no mesmo ciclo da venda de produtos. A UI lista só-estoque ainda sem família.';

ALTER TABLE public.epoc_day_stock_outs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members read day stock outs" ON public.epoc_day_stock_outs;
CREATE POLICY "Members read day stock outs"
  ON public.epoc_day_stock_outs FOR SELECT
  USING (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin)
  );

GRANT SELECT ON public.epoc_day_stock_outs TO authenticated;
GRANT ALL ON public.epoc_day_stock_outs TO service_role;

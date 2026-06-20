-- Menor/maior preço unitário efetivo por unidade (empresa) e produto global do fornecedor.

CREATE TABLE IF NOT EXISTS public.unified_supplier_product_company_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  unified_supplier_product_id UUID NOT NULL
    REFERENCES public.unified_supplier_products (id) ON DELETE CASCADE,
  min_price NUMERIC(18, 6),
  max_price NUMERIC(18, 6),
  last_effective_unit_price NUMERIC(18, 6),
  price_breakdown_last JSONB,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sighting_count INT NOT NULL DEFAULT 1 CHECK (sighting_count >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unified_supplier_product_company_prices_unique
    UNIQUE (company_id, unified_supplier_product_id)
);

COMMENT ON TABLE public.unified_supplier_product_company_prices IS
  'Faixa de preço unitário efetivo (NF-e) por unidade Faro e produto global (cProd do fornecedor).';
COMMENT ON COLUMN public.unified_supplier_product_company_prices.last_effective_unit_price IS
  'Último unitário efetivo observado nesta unidade (líquido da linha + rateio ICMSTot / qCom).';
COMMENT ON COLUMN public.unified_supplier_product_company_prices.price_breakdown_last IS
  'Snapshot do último cálculo (vProd, descontos, frete, rateio global).';

CREATE INDEX IF NOT EXISTS idx_unified_supplier_product_company_prices_company
  ON public.unified_supplier_product_company_prices (company_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_unified_supplier_product_company_prices_product
  ON public.unified_supplier_product_company_prices (unified_supplier_product_id);

DROP TRIGGER IF EXISTS unified_supplier_product_company_prices_set_updated_at
  ON public.unified_supplier_product_company_prices;
CREATE TRIGGER unified_supplier_product_company_prices_set_updated_at
  BEFORE UPDATE ON public.unified_supplier_product_company_prices
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.unified_supplier_product_company_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read unified supplier product company prices"
  ON public.unified_supplier_product_company_prices;
CREATE POLICY "Authenticated read unified supplier product company prices"
  ON public.unified_supplier_product_company_prices FOR SELECT
  TO authenticated
  USING (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  );

GRANT SELECT ON public.unified_supplier_product_company_prices TO authenticated;
GRANT ALL ON public.unified_supplier_product_company_prices TO service_role;

-- Preços globais no produto passam a ser por empresa (remover colunas antigas).
ALTER TABLE public.unified_supplier_products
  DROP COLUMN IF EXISTS min_price,
  DROP COLUMN IF EXISTS max_price;

-- Conversões por produto: equivalências a partir da unidade de estoque do produto (várias secundárias).

CREATE TABLE IF NOT EXISTS public.product_unit_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  primary_qty NUMERIC(18, 8) NOT NULL CHECK (primary_qty > 0),
  primary_unit_id UUID NOT NULL REFERENCES public.company_units(id) ON DELETE CASCADE,
  secondary_qty NUMERIC(18, 8) NOT NULL CHECK (secondary_qty > 0),
  secondary_unit_id UUID NOT NULL REFERENCES public.company_units(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_unit_conversions_distinct_units CHECK (primary_unit_id <> secondary_unit_id),
  CONSTRAINT product_unit_conversions_pair_unique UNIQUE (product_id, secondary_unit_id)
);

CREATE INDEX IF NOT EXISTS idx_product_unit_conversions_product
  ON public.product_unit_conversions(product_id);

CREATE INDEX IF NOT EXISTS idx_product_unit_conversions_company
  ON public.product_unit_conversions(company_id);

COMMENT ON TABLE public.product_unit_conversions IS
  'Por produto: primary_qty da unidade de estoque = secondary_qty da outra unidade.';

CREATE OR REPLACE FUNCTION public.enforce_product_unit_conversion_primary()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  pu TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = NEW.product_id AND p.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'Produto inválido para a empresa';
  END IF;

  SELECT p.unit INTO pu FROM public.products p WHERE p.id = NEW.product_id;
  IF pu IS NULL THEN
    RAISE EXCEPTION 'Produto não encontrado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.company_units cu
    WHERE cu.id = NEW.primary_unit_id
      AND cu.company_id = NEW.company_id
      AND lower(trim(cu.code)) = lower(trim(pu))
  ) THEN
    RAISE EXCEPTION 'A conversão deve usar como referência a unidade de estoque do produto';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.company_units su
    WHERE su.id = NEW.secondary_unit_id
      AND lower(trim(su.code)) = lower(trim(pu))
  ) THEN
    RAISE EXCEPTION 'A unidade secundária deve ser diferente da unidade de estoque';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_product_unit_conversions_check ON public.product_unit_conversions;
CREATE TRIGGER tr_product_unit_conversions_check
  BEFORE INSERT OR UPDATE OF primary_unit_id, secondary_unit_id, product_id, company_id
  ON public.product_unit_conversions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_product_unit_conversion_primary();

ALTER TABLE public.product_unit_conversions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage product unit conversions"
  ON public.product_unit_conversions FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

GRANT ALL ON public.product_unit_conversions TO anon, authenticated;

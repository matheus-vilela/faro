-- Conversões por produto passam a usar códigos de unidade (catálogo do sistema), sem FK em company_units.

-- Remover trigger/função antigos antes de alterar colunas (dependem de primary_unit_id / secondary_unit_id).
DROP TRIGGER IF EXISTS tr_product_unit_conversions_check ON public.product_unit_conversions;
DROP FUNCTION IF EXISTS public.enforce_product_unit_conversion_primary();

ALTER TABLE public.product_unit_conversions
  ADD COLUMN IF NOT EXISTS primary_unit_code TEXT,
  ADD COLUMN IF NOT EXISTS secondary_unit_code TEXT;

UPDATE public.product_unit_conversions puc
SET
  primary_unit_code = pu.code,
  secondary_unit_code = su.code
FROM public.company_units pu, public.company_units su
WHERE puc.primary_unit_id = pu.id
  AND puc.secondary_unit_id = su.id
  AND (puc.primary_unit_code IS NULL OR puc.secondary_unit_code IS NULL);

DELETE FROM public.product_unit_conversions
WHERE primary_unit_code IS NULL OR secondary_unit_code IS NULL;

ALTER TABLE public.product_unit_conversions
  ALTER COLUMN primary_unit_code SET NOT NULL,
  ALTER COLUMN secondary_unit_code SET NOT NULL;

ALTER TABLE public.product_unit_conversions
  DROP CONSTRAINT IF EXISTS product_unit_conversions_distinct_units;

ALTER TABLE public.product_unit_conversions
  DROP CONSTRAINT IF EXISTS product_unit_conversions_pair_unique;

ALTER TABLE public.product_unit_conversions
  DROP CONSTRAINT IF EXISTS product_unit_conversions_primary_unit_id_fkey;

ALTER TABLE public.product_unit_conversions
  DROP CONSTRAINT IF EXISTS product_unit_conversions_secondary_unit_id_fkey;

ALTER TABLE public.product_unit_conversions
  DROP COLUMN IF EXISTS primary_unit_id,
  DROP COLUMN IF EXISTS secondary_unit_id;

ALTER TABLE public.product_unit_conversions
  ADD CONSTRAINT product_unit_conversions_distinct_codes
  CHECK (
    lower(trim(primary_unit_code)) <> lower(trim(secondary_unit_code))
  );

CREATE UNIQUE INDEX IF NOT EXISTS product_unit_conversions_product_secondary_unique
  ON public.product_unit_conversions (product_id, secondary_unit_code);

CREATE OR REPLACE FUNCTION public.enforce_product_unit_conversion_codes()
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

  IF lower(trim(NEW.primary_unit_code)) <> lower(trim(pu)) THEN
    RAISE EXCEPTION 'A unidade da conversão deve ser a unidade de estoque do produto';
  END IF;

  IF lower(trim(NEW.secondary_unit_code)) = lower(trim(pu)) THEN
    RAISE EXCEPTION 'A unidade secundária deve ser diferente da unidade de estoque';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tr_product_unit_conversions_codes_check
  BEFORE INSERT OR UPDATE OF primary_unit_code, secondary_unit_code, product_id, company_id
  ON public.product_unit_conversions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_product_unit_conversion_codes();

COMMENT ON TABLE public.product_unit_conversions IS
  'Por produto: equivalências entre a unidade de estoque (products.unit) e outras unidades do catálogo.';

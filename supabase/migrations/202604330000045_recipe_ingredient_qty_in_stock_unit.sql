-- Converte quantidade de ingrediente de receita para a unidade de estoque do produto (hub).
-- Alinha com web/src/lib/companyUnits/convert.ts: conversao hub/secundaria + unidades de sistema (massa/volume).

CREATE OR REPLACE FUNCTION public.system_unit_ratio(p_from text, p_to text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  f text := lower(trim(p_from));
  t text := lower(trim(p_to));
  vf numeric;
  vt numeric;
BEGIN
  IF f IS NULL OR t IS NULL OR f = '' OR t = '' THEN
    RETURN NULL;
  END IF;
  IF f = t THEN
    RETURN 1;
  END IF;

  vf := CASE f
    WHEN 'mg' THEN 1
    WHEN 'g' THEN 1000
    WHEN 'kg' THEN 1000000
    ELSE NULL
  END;
  vt := CASE t
    WHEN 'mg' THEN 1
    WHEN 'g' THEN 1000
    WHEN 'kg' THEN 1000000
    ELSE NULL
  END;
  IF vf IS NOT NULL AND vt IS NOT NULL THEN
    RETURN vf / vt;
  END IF;

  vf := CASE f
    WHEN 'ml' THEN 1
    WHEN 'l' THEN 1000
    ELSE NULL
  END;
  vt := CASE t
    WHEN 'ml' THEN 1
    WHEN 'l' THEN 1000
    ELSE NULL
  END;
  IF vf IS NOT NULL AND vt IS NOT NULL THEN
    RETURN vf / vt;
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.recipe_ingredient_qty_in_stock_unit(
  p_product_id uuid,
  p_quantity numeric,
  p_input_quantity numeric,
  p_input_unit_code text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  hu text;
  iu text;
  pq numeric;
  sq numeric;
  r numeric;
BEGIN
  SELECT lower(trim(p.unit)) INTO hu
  FROM public.products p
  WHERE p.id = p_product_id;

  IF hu IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_input_quantity IS NULL
     OR p_input_unit_code IS NULL
     OR btrim(p_input_unit_code) = '' THEN
    RETURN p_quantity;
  END IF;

  iu := lower(trim(p_input_unit_code));

  IF iu = hu THEN
    RETURN coalesce(p_quantity, p_input_quantity);
  END IF;

  SELECT c.primary_qty::numeric, c.secondary_qty::numeric
  INTO pq, sq
  FROM public.product_unit_conversions c
  WHERE c.product_id = p_product_id
    AND lower(trim(c.primary_unit_code)) = hu
    AND lower(trim(c.secondary_unit_code)) = iu
  LIMIT 1;

  IF FOUND AND sq IS NOT NULL AND sq <> 0 THEN
    RETURN p_input_quantity * (pq / sq);
  END IF;

  r := public.system_unit_ratio(iu, hu);
  IF r IS NOT NULL THEN
    RETURN p_input_quantity * r;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.recipe_ingredient_qty_in_stock_unit(uuid, numeric, numeric, text) IS
  'Quantidade do ingrediente na unidade de estoque (input_quantity/unit e conversoes).';

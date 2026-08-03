-- Correlação: permitir ligar insumo a ficha sem output_product_id.
-- Antes: IF v_output_product_id IS NULL → recipe_not_found (falsos negativos).

CREATE OR REPLACE FUNCTION public.dashboard_product_recipe_add_ingredient(
  p_company_id UUID,
  p_recipe_id UUID,
  p_ingredient_product_id UUID,
  p_input_quantity DOUBLE PRECISION DEFAULT 1,
  p_input_unit_code TEXT DEFAULT NULL,
  p_upsert_conversion BOOLEAN DEFAULT false,
  p_conv_secondary_unit_code TEXT DEFAULT NULL,
  p_conv_primary_qty DOUBLE PRECISION DEFAULT NULL,
  p_conv_secondary_qty DOUBLE PRECISION DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipe_id UUID;
  v_output_product_id UUID;
  v_ing_unit TEXT;
  v_input_unit TEXT;
  v_input_qty NUMERIC;
  v_stock_qty NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF NOT (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
    )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT r.id, r.output_product_id
  INTO v_recipe_id, v_output_product_id
  FROM public.recipes r
  WHERE r.id = p_recipe_id
    AND r.company_id = p_company_id
    AND r.active IS NOT FALSE;

  IF v_recipe_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recipe_not_found');
  END IF;

  IF v_output_product_id IS NOT NULL
     AND v_output_product_id = p_ingredient_product_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'same_product');
  END IF;

  v_input_qty := GREATEST(coalesce(p_input_quantity, 1)::numeric, 0.0001::numeric);

  SELECT coalesce(nullif(trim(p.unit), ''), 'un')
  INTO v_ing_unit
  FROM public.products p
  WHERE p.id = p_ingredient_product_id AND p.company_id = p_company_id;

  IF v_ing_unit IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_not_found');
  END IF;

  v_input_unit := lower(trim(coalesce(nullif(trim(p_input_unit_code), ''), v_ing_unit)));

  IF p_upsert_conversion IS TRUE
     AND p_conv_secondary_unit_code IS NOT NULL
     AND btrim(p_conv_secondary_unit_code) <> ''
     AND lower(trim(p_conv_secondary_unit_code)) <> lower(trim(v_ing_unit))
  THEN
    IF coalesce(p_conv_primary_qty, 0) <= 0 OR coalesce(p_conv_secondary_qty, 0) <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_conversion');
    END IF;

    PERFORM public.upsert_product_unit_conversion(
      p_ingredient_product_id,
      p_conv_primary_qty::numeric,
      v_ing_unit,
      p_conv_secondary_qty::numeric,
      p_conv_secondary_unit_code
    );
  END IF;

  v_stock_qty := public.recipe_ingredient_qty_in_stock_unit(
    p_ingredient_product_id,
    v_input_qty,
    v_input_qty,
    v_input_unit
  );

  IF v_stock_qty IS NULL OR v_stock_qty <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unit_conversion_failed');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.recipe_ingredients ri
    WHERE ri.recipe_id = p_recipe_id AND ri.product_id = p_ingredient_product_id
  ) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'recipe_id', p_recipe_id,
      'already_linked', true
    );
  END IF;

  INSERT INTO public.recipe_ingredients (
    recipe_id,
    product_id,
    quantity,
    input_quantity,
    input_unit_code
  )
  VALUES (
    p_recipe_id,
    p_ingredient_product_id,
    v_stock_qty,
    v_input_qty,
    v_input_unit
  );

  RETURN jsonb_build_object(
    'ok', true,
    'recipe_id', p_recipe_id,
    'output_product_id', v_output_product_id,
    'ingredient_product_id', p_ingredient_product_id,
    'stock_quantity', v_stock_qty,
    'input_unit_code', v_input_unit
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'message', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.dashboard_product_recipe_add_ingredient(UUID, UUID, UUID, DOUBLE PRECISION, TEXT, BOOLEAN, TEXT, DOUBLE PRECISION, DOUBLE PRECISION) IS
  'Correlação: adiciona produto comprado como insumo de ficha existente (output opcional).';

GRANT EXECUTE ON FUNCTION public.dashboard_product_recipe_add_ingredient(UUID, UUID, UUID, DOUBLE PRECISION, TEXT, BOOLEAN, TEXT, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

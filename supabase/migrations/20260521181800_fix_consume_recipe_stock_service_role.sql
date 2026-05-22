-- EPOC / jobs CSV chamam create_revenue_entry com service_role (auth.uid() nulo).
-- O antigo `company_id NOT IN (SELECT … WHERE user_id = auth.uid())` com subquery vazio
-- avaliava NOT IN como TRUE e devolvia forbidden. Permite service_role e estoque negativo em jobs.

CREATE OR REPLACE FUNCTION public.consume_recipe_stock(
  p_recipe_id UUID,
  p_portions DECIMAL,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_scale DECIMAL;
  v_ing RECORD;
  v_per DECIMAL;
  v_need DECIMAL;
  v_curr DECIMAL;
  v_ref_type TEXT;
  v_ref_id UUID;
  v_is_service_role BOOLEAN;
BEGIN
  IF p_portions IS NULL OR p_portions <= 0 THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_portions');
  END IF;

  v_is_service_role := coalesce(auth.jwt() ->> 'role', '') = 'service_role';

  SELECT r.id, r.company_id, r.batch_yield, r.active
  INTO v_rec
  FROM public.recipes r
  WHERE r.id = p_recipe_id;

  IF v_rec.id IS NULL OR v_rec.active IS NOT TRUE THEN
    RETURN json_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF auth.uid() IS NULL THEN
    IF NOT v_is_service_role THEN
      RETURN json_build_object('ok', false, 'error', 'not_authenticated');
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM public.user_companies uc
    WHERE uc.user_id = auth.uid()
      AND uc.company_id = v_rec.company_id
  ) THEN
    RETURN json_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF p_reference_id IS NOT NULL THEN
    v_ref_type := coalesce(nullif(btrim(p_reference_type), ''), 'revenue_entry');
    v_ref_id := p_reference_id;
  ELSE
    v_ref_type := 'recipe';
    v_ref_id := v_rec.id;
  END IF;

  v_scale := p_portions / v_rec.batch_yield;

  FOR v_ing IN
    SELECT ri.product_id, ri.quantity, ri.input_quantity, ri.input_unit_code
    FROM public.recipe_ingredients ri
    WHERE ri.recipe_id = v_rec.id
    ORDER BY ri.id
  LOOP
    v_per := public.recipe_ingredient_qty_in_stock_unit(
      v_ing.product_id, v_ing.quantity, v_ing.input_quantity, v_ing.input_unit_code
    );
    IF v_per IS NULL THEN
      RETURN json_build_object(
        'ok', false,
        'error', 'missing_conversion',
        'product_id', v_ing.product_id
      );
    END IF;
    v_need := v_per * v_scale;
    IF v_need <= 0 THEN
      CONTINUE;
    END IF;

    SELECT p.current_quantity INTO v_curr
    FROM public.products p
    WHERE p.id = v_ing.product_id
    FOR UPDATE;

    IF v_curr IS NULL THEN
      RETURN json_build_object(
        'ok', false,
        'error', 'product_not_found',
        'product_id', v_ing.product_id
      );
    END IF;

    IF NOT v_is_service_role AND v_curr < v_need THEN
      RETURN json_build_object(
        'ok', false,
        'error', 'insufficient_stock',
        'product_id', v_ing.product_id,
        'need', v_need,
        'have', v_curr
      );
    END IF;

    PERFORM public.adjust_product_stock(
      v_ing.product_id,
      -v_need,
      'out',
      v_ref_type,
      v_ref_id,
      NULL
    );
  END LOOP;

  RETURN json_build_object('ok', true);
END;
$$;

COMMENT ON FUNCTION public.consume_recipe_stock(UUID, DECIMAL, TEXT, UUID) IS
  'Consome ingredientes da receita. service_role (import EPOC/CSV) não exige auth.uid nem estoque prévio nos insumos.';

GRANT EXECUTE ON FUNCTION public.consume_recipe_stock(UUID, DECIMAL, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_recipe_stock(UUID, DECIMAL, TEXT, UUID) TO service_role;

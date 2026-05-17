-- Listas neutras (qualquer movimento in/out) e vínculo ficha ↔ insumo no dashboard pós-sync.

CREATE OR REPLACE FUNCTION public.dashboard_product_recipe_match_lists(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exit_only JSONB;
  v_entry_only JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('exit_only', '[]'::jsonb, 'entry_only', '[]'::jsonb);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object('exit_only', '[]'::jsonb, 'entry_only', '[]'::jsonb);
  END IF;

  WITH exit_cand AS (
    SELECT
      p.id AS product_id,
      p.name,
      p.unit,
      p.current_quantity::double precision AS current_quantity,
      r.id AS recipe_id
    FROM public.products p
    LEFT JOIN public.recipes r
      ON r.company_id = p_company_id AND r.output_product_id = p.id AND r.active IS NOT FALSE
    WHERE p.company_id = p_company_id
      AND (p.is_active IS DISTINCT FROM false)
      AND EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.product_id = p.id AND sm.type = 'out'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.product_id = p.id AND sm.type = 'in'
      )
  )
  SELECT coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_id', x.product_id,
          'name', x.name,
          'unit', x.unit,
          'current_quantity', x.current_quantity,
          'recipe_id', x.recipe_id
        )
        ORDER BY x.name ASC
      )
      FROM (SELECT * FROM exit_cand ORDER BY name ASC LIMIT 80) x
    ),
    '[]'::jsonb
  )
  INTO v_exit_only;

  WITH entry_cand AS (
    SELECT
      p.id AS product_id,
      p.name,
      p.unit,
      p.current_quantity::double precision AS current_quantity
    FROM public.products p
    WHERE p.company_id = p_company_id
      AND (p.is_active IS DISTINCT FROM false)
      AND EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.product_id = p.id AND sm.type = 'in'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.product_id = p.id AND sm.type = 'out'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.recipes r
        WHERE r.company_id = p_company_id AND r.output_product_id = p.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.recipe_ingredients ri
        INNER JOIN public.recipes r ON r.id = ri.recipe_id AND r.company_id = p_company_id
        WHERE ri.product_id = p.id
      )
  )
  SELECT coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_id', x.product_id,
          'name', x.name,
          'unit', x.unit,
          'current_quantity', x.current_quantity
        )
        ORDER BY x.name ASC
      )
      FROM (SELECT * FROM entry_cand ORDER BY name ASC LIMIT 80) x
    ),
    '[]'::jsonb
  )
  INTO v_entry_only;

  RETURN jsonb_build_object(
    'exit_only', coalesce(v_exit_only, '[]'::jsonb),
    'entry_only', coalesce(v_entry_only, '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.dashboard_product_recipe_match_lists(UUID) IS
  'Dashboard pós-sync: produtos só com saída (candidatos a ficha) e só com entrada (candidatos a insumo), sem filtros por origem do movimento.';

CREATE OR REPLACE FUNCTION public.dashboard_product_recipe_match_link(
  p_company_id UUID,
  p_output_product_id UUID,
  p_ingredient_product_id UUID,
  p_quantity DOUBLE PRECISION DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipe_id UUID;
  v_out_name TEXT;
  v_ing_name TEXT;
  v_ing_unit TEXT;
  v_qty DOUBLE PRECISION;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_output_product_id = p_ingredient_product_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'same_product');
  END IF;

  v_qty := GREATEST(coalesce(p_quantity, 1), 0.0001);

  SELECT p.name INTO v_out_name
  FROM public.products p
  WHERE p.id = p_output_product_id AND p.company_id = p_company_id;

  SELECT p.name, coalesce(nullif(trim(p.unit), ''), 'un')
  INTO v_ing_name, v_ing_unit
  FROM public.products p
  WHERE p.id = p_ingredient_product_id AND p.company_id = p_company_id;

  IF v_out_name IS NULL OR v_ing_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_not_found');
  END IF;

  SELECT r.id INTO v_recipe_id
  FROM public.recipes r
  WHERE r.company_id = p_company_id
    AND r.output_product_id = p_output_product_id
    AND r.active IS NOT FALSE
  ORDER BY r.updated_at DESC NULLS LAST, r.created_at DESC
  LIMIT 1;

  IF v_recipe_id IS NULL THEN
    INSERT INTO public.recipes (
      company_id,
      name,
      output_product_id,
      batch_yield,
      active,
      recipe_type
    )
    VALUES (
      p_company_id,
      left(trim(v_out_name) || ' — ficha técnica', 500),
      p_output_product_id,
      1,
      true,
      'PREP'
    )
    RETURNING id INTO v_recipe_id;

    UPDATE public.products
    SET stock_control_type = 'RECIPE_CONTROLLED', updated_at = now()
    WHERE id = p_output_product_id AND company_id = p_company_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.recipe_ingredients ri
    WHERE ri.recipe_id = v_recipe_id AND ri.product_id = p_ingredient_product_id
  ) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'recipe_id', v_recipe_id,
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
    v_recipe_id,
    p_ingredient_product_id,
    v_qty,
    v_qty,
    v_ing_unit
  );

  RETURN jsonb_build_object(
    'ok', true,
    'recipe_id', v_recipe_id,
    'output_product_id', p_output_product_id,
    'ingredient_product_id', p_ingredient_product_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'message', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.dashboard_product_recipe_match_link(UUID, UUID, UUID, DOUBLE PRECISION) IS
  'Cria ficha (se necessário) para produto só com saída e adiciona produto só com entrada como insumo.';

GRANT EXECUTE ON FUNCTION public.dashboard_product_recipe_match_lists(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_product_recipe_match_link(UUID, UUID, UUID, DOUBLE PRECISION) TO authenticated;

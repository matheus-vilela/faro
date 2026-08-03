-- Correlação centrada em compras: purchases + utilizações (fichas) + sold_only.
-- Mantém compras que já são insumos; remove only-after merge/dismiss.
-- RPCs para adicionar/remover insumo por recipe_id.

CREATE OR REPLACE FUNCTION public.dashboard_product_recipe_match_lists(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchases JSONB;
  v_sold_only JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('purchases', '[]'::jsonb, 'sold_only', '[]'::jsonb);
  END IF;
  IF NOT (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
    )
  ) THEN
    RETURN jsonb_build_object('purchases', '[]'::jsonb, 'sold_only', '[]'::jsonb);
  END IF;

  WITH purchase_cand AS (
    SELECT
      p.id AS product_id,
      p.name,
      p.unit,
      p.sku,
      p.ean,
      p.barcode,
      p.current_quantity::double precision AS current_quantity,
      coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'tipo', 'FICHA_TECNICA',
            'idDestino', r.id,
            'nomeDestino', r.name
          )
          ORDER BY r.name ASC
        )
        FROM public.recipe_ingredients ri
        INNER JOIN public.recipes r
          ON r.id = ri.recipe_id
         AND r.company_id = p_company_id
        WHERE ri.product_id = p.id
      ), '[]'::jsonb) AS utilizations
    FROM public.products p
    WHERE p.company_id = p_company_id
      AND (p.is_active IS DISTINCT FROM false)
      AND EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.product_id = p.id
          AND sm.type = 'in'
          AND coalesce(sm.reference_type, '') NOT IN ('product_merge', 'product_merge_undo')
          AND (sm.metadata_json->>'undone_at') IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.product_id = p.id
          AND sm.type = 'out'
          AND coalesce(sm.reference_type, '') NOT IN ('product_merge', 'product_merge_undo')
          AND (sm.metadata_json->>'undone_at') IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.recipes r
        WHERE r.company_id = p_company_id AND r.output_product_id = p.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.product_import_dashboard_review rev
        WHERE rev.company_id = p_company_id
          AND rev.product_id = p.id
          AND rev.review_bucket = 'ENTRY_NO_EXIT'
          AND rev.resolution = 'DISMISSED'
      )
  )
  SELECT coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_id', x.product_id,
          'name', x.name,
          'unit', x.unit,
          'sku', x.sku,
          'ean', x.ean,
          'barcode', x.barcode,
          'current_quantity', x.current_quantity,
          'utilizations', x.utilizations
        )
        ORDER BY
          CASE WHEN jsonb_array_length(x.utilizations) = 0 THEN 0 ELSE 1 END,
          x.name ASC
      )
      FROM (
        SELECT *
        FROM purchase_cand
        ORDER BY
          CASE WHEN jsonb_array_length(utilizations) = 0 THEN 0 ELSE 1 END,
          name ASC
        LIMIT 120
      ) x
    ),
    '[]'::jsonb
  )
  INTO v_purchases;

  WITH sold_cand AS (
    SELECT
      p.id AS product_id,
      p.name,
      p.unit,
      p.sku,
      p.ean,
      p.barcode,
      p.current_quantity::double precision AS current_quantity,
      r.id AS recipe_id
    FROM public.products p
    LEFT JOIN public.recipes r
      ON r.company_id = p_company_id AND r.output_product_id = p.id AND r.active IS NOT FALSE
    WHERE p.company_id = p_company_id
      AND (p.is_active IS DISTINCT FROM false)
      AND EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.product_id = p.id
          AND sm.type = 'out'
          AND coalesce(sm.reference_type, '') NOT IN ('product_merge', 'product_merge_undo')
          AND (sm.metadata_json->>'undone_at') IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.product_id = p.id
          AND sm.type = 'in'
          AND coalesce(sm.reference_type, '') NOT IN ('product_merge', 'product_merge_undo')
          AND (sm.metadata_json->>'undone_at') IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.product_import_dashboard_review rev
        WHERE rev.company_id = p_company_id
          AND rev.product_id = p.id
          AND rev.review_bucket = 'EXIT_NO_ENTRY'
          AND rev.resolution = 'DISMISSED'
      )
  )
  SELECT coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_id', x.product_id,
          'name', x.name,
          'unit', x.unit,
          'sku', x.sku,
          'ean', x.ean,
          'barcode', x.barcode,
          'current_quantity', x.current_quantity,
          'recipe_id', x.recipe_id
        )
        ORDER BY x.name ASC
      )
      FROM (SELECT * FROM sold_cand ORDER BY name ASC LIMIT 120) x
    ),
    '[]'::jsonb
  )
  INTO v_sold_only;

  RETURN jsonb_build_object(
    'purchases', coalesce(v_purchases, '[]'::jsonb),
    'sold_only', coalesce(v_sold_only, '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.dashboard_product_recipe_match_lists(UUID) IS
  'Dashboard correlação: purchases (só entrada + utilizações ficha) e sold_only (só saída); ignora merge sintético.';

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

  SELECT r.output_product_id
  INTO v_output_product_id
  FROM public.recipes r
  WHERE r.id = p_recipe_id
    AND r.company_id = p_company_id
    AND r.active IS NOT FALSE;

  IF v_output_product_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recipe_not_found');
  END IF;

  IF v_output_product_id = p_ingredient_product_id THEN
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
  'Correlação: adiciona produto comprado como insumo de ficha existente.';

GRANT EXECUTE ON FUNCTION public.dashboard_product_recipe_add_ingredient(UUID, UUID, UUID, DOUBLE PRECISION, TEXT, BOOLEAN, TEXT, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;

CREATE OR REPLACE FUNCTION public.dashboard_product_recipe_remove_ingredient(
  p_company_id UUID,
  p_recipe_id UUID,
  p_ingredient_product_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT;
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

  IF NOT EXISTS (
    SELECT 1 FROM public.recipes r
    WHERE r.id = p_recipe_id AND r.company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recipe_not_found');
  END IF;

  DELETE FROM public.recipe_ingredients ri
  WHERE ri.recipe_id = p_recipe_id
    AND ri.product_id = p_ingredient_product_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ingredient_not_linked');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'recipe_id', p_recipe_id,
    'ingredient_product_id', p_ingredient_product_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'message', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.dashboard_product_recipe_remove_ingredient(UUID, UUID, UUID) IS
  'Correlação: remove vínculo de insumo (produto comprado) da ficha.';

GRANT EXECUTE ON FUNCTION public.dashboard_product_recipe_remove_ingredient(UUID, UUID, UUID) TO authenticated;

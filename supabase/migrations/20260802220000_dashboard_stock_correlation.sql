-- Correlação estoque no dashboard: admin access, exclui dispensados, sku/ean para sugestões.

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
  IF NOT (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
    )
  ) THEN
    RETURN jsonb_build_object('exit_only', '[]'::jsonb, 'entry_only', '[]'::jsonb);
  END IF;

  WITH exit_cand AS (
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
        WHERE sm.product_id = p.id AND sm.type = 'out'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.product_id = p.id AND sm.type = 'in'
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
      FROM (SELECT * FROM exit_cand ORDER BY name ASC LIMIT 120) x
    ),
    '[]'::jsonb
  )
  INTO v_exit_only;

  WITH entry_cand AS (
    SELECT
      p.id AS product_id,
      p.name,
      p.unit,
      p.sku,
      p.ean,
      p.barcode,
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
          'current_quantity', x.current_quantity
        )
        ORDER BY x.name ASC
      )
      FROM (SELECT * FROM entry_cand ORDER BY name ASC LIMIT 120) x
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
  'Dashboard: produtos só com saída / só com entrada; exclui dispensados; inclui sku/ean para sugestões.';

CREATE OR REPLACE FUNCTION public.dashboard_import_review_set_resolution(
  p_company_id UUID,
  p_product_id UUID,
  p_bucket TEXT,
  p_resolution TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF p_bucket NOT IN ('ENTRY_NO_EXIT', 'EXIT_NO_ENTRY', 'RECIPE_NO_INGREDIENTS') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_bucket');
  END IF;
  IF p_resolution NOT IN ('DISMISSED', 'LINK_RECIPE_STARTED') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_resolution');
  END IF;

  INSERT INTO public.product_import_dashboard_review (
    company_id, product_id, review_bucket, resolution, resolved_at, resolved_by, updated_at
  )
  VALUES (
    p_company_id, p_product_id, p_bucket, p_resolution, now(), auth.uid(), now()
  )
  ON CONFLICT (company_id, product_id, review_bucket) DO UPDATE SET
    resolution = EXCLUDED.resolution,
    resolved_at = now(),
    resolved_by = auth.uid(),
    updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Mesma lógica de create_recipe; só libera platform admin.
CREATE OR REPLACE FUNCTION public.dashboard_product_recipe_match_create_recipe(
  p_company_id UUID,
  p_output_product_id UUID,
  p_ingredients JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipe_id UUID;
  v_out_name TEXT;
  v_ing JSONB;
  v_pid UUID;
  v_input_qty NUMERIC;
  v_input_unit TEXT;
  v_stock_qty NUMERIC;
  v_inserted INT := 0;
  v_seen UUID[] := ARRAY[]::UUID[];
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

  IF p_ingredients IS NULL OR jsonb_typeof(p_ingredients) <> 'array' OR jsonb_array_length(p_ingredients) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ingredients_required');
  END IF;

  SELECT p.name INTO v_out_name
  FROM public.products p
  WHERE p.id = p_output_product_id AND p.company_id = p_company_id;

  IF v_out_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'output_not_found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.recipes r
    WHERE r.company_id = p_company_id
      AND r.output_product_id = p_output_product_id
      AND r.active IS NOT FALSE
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recipe_already_exists');
  END IF;

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

  FOR v_ing IN SELECT * FROM jsonb_array_elements(p_ingredients)
  LOOP
    v_pid := (v_ing->>'product_id')::uuid;
    IF v_pid IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_ingredient');
    END IF;
    IF v_pid = p_output_product_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'same_product');
    END IF;
    IF v_pid = ANY (v_seen) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'duplicate_ingredient');
    END IF;
    v_seen := array_append(v_seen, v_pid);

    v_input_qty := GREATEST(coalesce((v_ing->>'input_quantity')::numeric, 1), 0.0001::numeric);
    v_input_unit := lower(trim(coalesce(nullif(trim(v_ing->>'input_unit_code'), ''), '')));

    IF v_input_unit = '' THEN
      SELECT lower(trim(coalesce(nullif(trim(p.unit), ''), 'un')))
      INTO v_input_unit
      FROM public.products p
      WHERE p.id = v_pid AND p.company_id = p_company_id;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = v_pid AND p.company_id = p_company_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ingredient_not_found');
    END IF;

    v_stock_qty := public.recipe_ingredient_qty_in_stock_unit(
      v_pid,
      v_input_qty,
      v_input_qty,
      v_input_unit
    );

    IF v_stock_qty IS NULL OR v_stock_qty <= 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'unit_conversion_failed',
        'product_id', v_pid
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
      v_pid,
      v_stock_qty,
      v_input_qty,
      v_input_unit
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'recipe_id', v_recipe_id,
    'ingredients_count', v_inserted
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'message', SQLERRM);
END;
$$;

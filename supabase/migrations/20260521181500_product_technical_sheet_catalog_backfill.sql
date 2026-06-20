-- Ficha técnica: prato some do catálogo de produtos; histórico de saídas do prato vira saídas nos insumos.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS listed_in_product_catalog BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.products.listed_in_product_catalog IS
  'false = produto-prato de ficha técnica (exibido só em Receitas / ficha), não na listagem de Produtos.';

CREATE INDEX IF NOT EXISTS idx_products_company_catalog_listed
  ON public.products (company_id, listed_in_product_catalog)
  WHERE listed_in_product_catalog IS TRUE;

-- Fichas já cadastradas antes desta migração
UPDATE public.products p
SET listed_in_product_catalog = false, updated_at = now()
WHERE listed_in_product_catalog IS TRUE
  AND EXISTS (
    SELECT 1
    FROM public.recipes r
    WHERE r.output_product_id = p.id
      AND r.recipe_type IN ('PREP', 'SALE')
      AND r.active IS NOT FALSE
  );

CREATE OR REPLACE FUNCTION public.backfill_technical_sheet_from_output_history(
  p_recipe_id UUID,
  p_output_product_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_yield NUMERIC;
  v_mov RECORD;
  v_ing RECORD;
  v_need NUMERIC;
  v_out_count INT := 0;
  v_ing_mov_count INT := 0;
BEGIN
  SELECT GREATEST(coalesce(r.batch_yield, 1), 0.0001::numeric)
  INTO v_yield
  FROM public.recipes r
  WHERE r.id = p_recipe_id;

  IF v_yield IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recipe_not_found');
  END IF;

  FOR v_mov IN
    SELECT sm.id, sm.quantity, sm.reference_type, sm.reference_id
    FROM public.stock_movements sm
    WHERE sm.product_id = p_output_product_id
      AND sm.type = 'out'
      AND sm.quantity > 0
      AND NOT EXISTS (
        SELECT 1
        FROM public.stock_movements bf
        WHERE bf.reference_type = 'technical_sheet_backfill'
          AND bf.reference_id = sm.id
      )
    ORDER BY sm.created_at ASC
  LOOP
    v_out_count := v_out_count + 1;

    FOR v_ing IN
      SELECT ri.product_id, ri.quantity
      FROM public.recipe_ingredients ri
      WHERE ri.recipe_id = p_recipe_id
    LOOP
      v_need := v_mov.quantity * v_ing.quantity / v_yield;
      IF v_need <= 0 THEN
        CONTINUE;
      END IF;

      PERFORM public.adjust_product_stock(
        v_ing.product_id,
        -v_need,
        'out',
        'technical_sheet_backfill',
        v_mov.id,
        NULL
      );
      v_ing_mov_count := v_ing_mov_count + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'output_out_movements', v_out_count,
    'ingredient_movements_created', v_ing_mov_count
  );
END;
$$;

COMMENT ON FUNCTION public.backfill_technical_sheet_from_output_history(UUID, UUID) IS
  'Replica saídas históricas do prato para cada insumo da ficha (proporção por rendimento).';

GRANT EXECUTE ON FUNCTION public.backfill_technical_sheet_from_output_history(UUID, UUID)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.upsert_product_technical_sheet(
  p_company_id UUID,
  p_output_product_id UUID,
  p_ingredients JSONB,
  p_batch_yield NUMERIC DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_out_name TEXT;
  v_recipe_id UUID;
  v_ing JSONB;
  v_pid UUID;
  v_input_qty NUMERIC;
  v_input_unit TEXT;
  v_stock_qty NUMERIC;
  v_inserted INT := 0;
  v_seen UUID[] := ARRAY[]::UUID[];
  v_yield NUMERIC;
  v_backfill JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = v_uid AND uc.company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF p_ingredients IS NULL OR jsonb_typeof(p_ingredients) <> 'array' OR jsonb_array_length(p_ingredients) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ingredients_required');
  END IF;

  v_yield := GREATEST(coalesce(p_batch_yield, 1), 0.0001::numeric);

  SELECT p.name INTO v_out_name
  FROM public.products p
  WHERE p.id = p_output_product_id AND p.company_id = p_company_id;

  IF v_out_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'output_not_found');
  END IF;

  SELECT r.id INTO v_recipe_id
  FROM public.recipes r
  WHERE r.company_id = p_company_id
    AND r.output_product_id = p_output_product_id
    AND r.recipe_type IN ('PREP', 'SALE')
  ORDER BY r.updated_at DESC
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
      v_yield,
      true,
      'PREP'
    )
    RETURNING id INTO v_recipe_id;
  ELSE
    UPDATE public.recipes
    SET
      batch_yield = v_yield,
      active = true,
      updated_at = now()
    WHERE id = v_recipe_id;
    DELETE FROM public.recipe_ingredients WHERE recipe_id = v_recipe_id;
  END IF;

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

  UPDATE public.products
  SET
    stock_control_type = 'RECIPE_CONTROLLED',
    listed_in_product_catalog = false,
    updated_at = now()
  WHERE id = p_output_product_id AND company_id = p_company_id;

  INSERT INTO public.product_operational_config (
    company_id,
    product_id,
    suggested_operational_type,
    suggested_score,
    suggestion_reasons,
    final_operational_type,
    final_decision_source,
    configuration_status,
    configuration_completeness,
    notes,
    last_edited_at,
    last_edited_by
  ) VALUES (
    p_company_id,
    p_output_product_id,
    'ITEM_OPERACIONAL',
    1,
    jsonb_build_object('source', 'product_technical_sheet'),
    'ITEM_OPERACIONAL',
    'USER_EDITED',
    'CONFIGURADO',
    jsonb_build_object('technical_sheet', true, 'recipe_id', v_recipe_id),
    'Ficha técnica — não listado no catálogo de produtos',
    now(),
    v_uid
  )
  ON CONFLICT (company_id, product_id) DO UPDATE SET
    final_operational_type = EXCLUDED.final_operational_type,
    final_decision_source = EXCLUDED.final_decision_source,
    configuration_status = EXCLUDED.configuration_status,
    configuration_completeness = EXCLUDED.configuration_completeness,
    notes = EXCLUDED.notes,
    last_edited_at = now(),
    last_edited_by = v_uid,
    updated_at = now();

  v_backfill := public.backfill_technical_sheet_from_output_history(
    v_recipe_id,
    p_output_product_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'recipe_id', v_recipe_id,
    'ingredients_count', v_inserted,
    'listed_in_product_catalog', false,
    'backfill', v_backfill
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'message', SQLERRM);
END;
$$;

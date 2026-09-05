-- Produto intermediário: ficha PRODUCTION com estoque próprio.
-- Venda baixa o intermediário; insumos saem só na produção.

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_stock_control_type_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_stock_control_type_check
  CHECK (stock_control_type IN (
    'DIRECT',
    'RECIPE_CONTROLLED',
    'COMPOSITE',
    'SERVICE',
    'SALE_FAMILY',
    'INTERMEDIATE'
  ));

COMMENT ON COLUMN public.products.stock_control_type IS
  'DIRECT = SKU de estoque; RECIPE_CONTROLLED = ficha (baixa insumos na venda); INTERMEDIATE = produção com estoque próprio (baixa o produto na venda); COMPOSITE = composto; SERVICE = sem estoque; SALE_FAMILY = agrupamento (venda não baixa).';

CREATE OR REPLACE FUNCTION public.get_product_technical_sheet(
  p_company_id UUID,
  p_output_product_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_sct TEXT;
  v_recipe RECORD;
  v_ings JSONB;
  v_kind TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT public.user_has_company_access(v_uid, p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT p.stock_control_type
  INTO v_sct
  FROM public.products p
  WHERE p.id = p_output_product_id AND p.company_id = p_company_id;

  IF v_sct IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = p_output_product_id AND p.company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_not_found');
  END IF;

  SELECT r.id, r.name, r.batch_yield, r.recipe_type, r.active
  INTO v_recipe
  FROM public.recipes r
  WHERE r.company_id = p_company_id
    AND r.output_product_id = p_output_product_id
    AND r.recipe_type IN ('PREP', 'SALE', 'PRODUCTION')
    AND r.active IS NOT FALSE
  ORDER BY
    CASE
      WHEN v_sct = 'INTERMEDIATE' AND r.recipe_type = 'PRODUCTION' THEN 0
      WHEN v_sct IS DISTINCT FROM 'INTERMEDIATE' AND r.recipe_type IN ('PREP', 'SALE') THEN 0
      ELSE 1
    END,
    r.updated_at DESC
  LIMIT 1;

  IF v_recipe.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'recipe', null, 'ingredients', '[]'::jsonb, 'sheet_kind', null);
  END IF;

  v_kind := CASE
    WHEN v_recipe.recipe_type = 'PRODUCTION' THEN 'intermediate'
    ELSE 'sale'
  END;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'product_id', ri.product_id,
        'name', p.name,
        'unit', p.unit,
        'input_quantity', coalesce(ri.input_quantity, ri.quantity),
        'input_unit_code', coalesce(nullif(btrim(ri.input_unit_code), ''), p.unit),
        'stock_quantity', ri.quantity
      )
      ORDER BY p.name
    ),
    '[]'::jsonb
  )
  INTO v_ings
  FROM public.recipe_ingredients ri
  JOIN public.products p ON p.id = ri.product_id
  WHERE ri.recipe_id = v_recipe.id;

  RETURN jsonb_build_object(
    'ok', true,
    'sheet_kind', v_kind,
    'recipe', jsonb_build_object(
      'id', v_recipe.id,
      'name', v_recipe.name,
      'batch_yield', v_recipe.batch_yield,
      'recipe_type', v_recipe.recipe_type
    ),
    'ingredients', v_ings
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_product_technical_sheet(UUID, UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.upsert_product_technical_sheet(UUID, UUID, JSONB, NUMERIC);

CREATE OR REPLACE FUNCTION public.upsert_product_technical_sheet(
  p_company_id UUID,
  p_output_product_id UUID,
  p_ingredients JSONB,
  p_batch_yield NUMERIC DEFAULT 1,
  p_sheet_kind TEXT DEFAULT 'sale'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_out_name TEXT;
  v_out_sct TEXT;
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
  v_kind TEXT := lower(trim(coalesce(p_sheet_kind, 'sale')));
  v_is_intermediate BOOLEAN;
  v_recipe_type TEXT;
  v_recipe_name TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT public.user_has_company_access(v_uid, p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF v_kind NOT IN ('sale', 'intermediate') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_sheet_kind');
  END IF;

  v_is_intermediate := v_kind = 'intermediate';
  v_recipe_type := CASE WHEN v_is_intermediate THEN 'PRODUCTION' ELSE 'PREP' END;

  IF p_ingredients IS NULL OR jsonb_typeof(p_ingredients) <> 'array' OR jsonb_array_length(p_ingredients) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ingredients_required');
  END IF;

  v_yield := GREATEST(coalesce(p_batch_yield, 1), 0.0001::numeric);

  SELECT p.name, p.stock_control_type
  INTO v_out_name, v_out_sct
  FROM public.products p
  WHERE p.id = p_output_product_id AND p.company_id = p_company_id;

  IF v_out_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'output_not_found');
  END IF;

  IF v_out_sct = 'SALE_FAMILY' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sale_family_forbidden');
  END IF;

  SELECT r.id INTO v_recipe_id
  FROM public.recipes r
  WHERE r.company_id = p_company_id
    AND r.output_product_id = p_output_product_id
    AND r.recipe_type IN ('PREP', 'SALE', 'PRODUCTION')
  ORDER BY
    CASE
      WHEN v_is_intermediate AND r.recipe_type = 'PRODUCTION' THEN 0
      WHEN NOT v_is_intermediate AND r.recipe_type IN ('PREP', 'SALE') THEN 0
      ELSE 1
    END,
    r.updated_at DESC
  LIMIT 1;

  v_recipe_name := left(
    trim(v_out_name) || CASE WHEN v_is_intermediate THEN ' — produção' ELSE ' — ficha técnica' END,
    500
  );

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
      v_recipe_name,
      p_output_product_id,
      v_yield,
      true,
      v_recipe_type
    )
    RETURNING id INTO v_recipe_id;
  ELSE
    UPDATE public.recipes
    SET
      name = v_recipe_name,
      batch_yield = v_yield,
      active = true,
      recipe_type = v_recipe_type,
      updated_at = now()
    WHERE id = v_recipe_id;
    DELETE FROM public.recipe_ingredients WHERE recipe_id = v_recipe_id;
  END IF;

  UPDATE public.recipes
  SET active = false, updated_at = now()
  WHERE company_id = p_company_id
    AND output_product_id = p_output_product_id
    AND id IS DISTINCT FROM v_recipe_id
    AND recipe_type IN ('PREP', 'SALE', 'PRODUCTION')
    AND active IS NOT FALSE;

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

  IF v_is_intermediate THEN
    UPDATE public.products
    SET
      stock_control_type = 'INTERMEDIATE',
      listed_in_product_catalog = true,
      updated_at = now()
    WHERE id = p_output_product_id AND company_id = p_company_id;
  ELSE
    UPDATE public.products
    SET
      stock_control_type = 'RECIPE_CONTROLLED',
      listed_in_product_catalog = false,
      updated_at = now()
    WHERE id = p_output_product_id AND company_id = p_company_id;
  END IF;

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
    jsonb_build_object('source', 'product_technical_sheet', 'sheet_kind', v_kind),
    'ITEM_OPERACIONAL',
    'USER_EDITED',
    'CONFIGURADO',
    jsonb_build_object('technical_sheet', true, 'recipe_id', v_recipe_id, 'sheet_kind', v_kind),
    CASE
      WHEN v_is_intermediate THEN 'Produto intermediário — listado no catálogo; insumos saem na produção'
      ELSE 'Ficha técnica — não listado no catálogo de produtos'
    END,
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

  IF v_is_intermediate OR v_out_sct = 'INTERMEDIATE' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'recipe_id', v_recipe_id,
      'ingredients_count', v_inserted,
      'sheet_kind', CASE WHEN v_is_intermediate THEN 'intermediate' ELSE 'sale' END,
      'listed_in_product_catalog', v_is_intermediate
    );
  END IF;

  v_backfill := public.backfill_technical_sheet_from_output_history(
    v_recipe_id,
    p_output_product_id
  );

  RETURN jsonb_build_object(
    'ok', true,
    'recipe_id', v_recipe_id,
    'ingredients_count', v_inserted,
    'sheet_kind', 'sale',
    'listed_in_product_catalog', false,
    'backfill', v_backfill
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'message', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.upsert_product_technical_sheet(UUID, UUID, JSONB, NUMERIC, TEXT) IS
  'Cria/atualiza ficha. sale = PREP + RECIPE_CONTROLLED (explode na venda). intermediate = PRODUCTION + INTERMEDIATE (estoca; sem backfill).';

GRANT EXECUTE ON FUNCTION public.upsert_product_technical_sheet(UUID, UUID, JSONB, NUMERIC, TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.produce_intermediate_product(
  p_company_id UUID,
  p_product_id UUID,
  p_quantity NUMERIC
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_sct TEXT;
  v_recipe RECORD;
  v_batch_id UUID := gen_random_uuid();
  v_consume JSON;
  v_ing RECORD;
  v_per NUMERIC;
  v_need NUMERIC;
  v_unit_cost NUMERIC;
  v_ing_cost NUMERIC;
  v_total_cost NUMERIC := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT public.user_has_company_access(v_uid, p_company_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_quantity');
  END IF;

  SELECT p.stock_control_type
  INTO v_sct
  FROM public.products p
  WHERE p.id = p_product_id AND p.company_id = p_company_id
  FOR UPDATE;

  IF v_sct IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_not_found');
  END IF;

  IF v_sct IS DISTINCT FROM 'INTERMEDIATE' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_intermediate');
  END IF;

  SELECT r.id, r.batch_yield, r.active
  INTO v_recipe
  FROM public.recipes r
  WHERE r.company_id = p_company_id
    AND r.output_product_id = p_product_id
    AND r.recipe_type = 'PRODUCTION'
    AND r.active IS NOT FALSE
  ORDER BY r.updated_at DESC
  LIMIT 1;

  IF v_recipe.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recipe_not_found');
  END IF;

  FOR v_ing IN
    SELECT
      ri.product_id,
      ri.quantity,
      ri.input_quantity,
      ri.input_unit_code,
      COALESCE(NULLIF(p.average_cost, 0), NULLIF(p.last_unit_value_stock, 0), NULLIF(p.last_unit_value, 0), 0) AS unit_cost
    FROM public.recipe_ingredients ri
    JOIN public.products p ON p.id = ri.product_id
    WHERE ri.recipe_id = v_recipe.id
  LOOP
    v_per := public.recipe_ingredient_qty_in_stock_unit(
      v_ing.product_id, v_ing.quantity, v_ing.input_quantity, v_ing.input_unit_code
    );
    IF v_per IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'missing_conversion',
        'product_id', v_ing.product_id
      );
    END IF;
    v_need := v_per * (p_quantity / v_recipe.batch_yield);
    IF v_need > 0 THEN
      v_total_cost := v_total_cost + (v_need * COALESCE(v_ing.unit_cost, 0));
    END IF;
  END LOOP;

  v_consume := public.consume_recipe_stock(
    v_recipe.id,
    p_quantity,
    'intermediate_production',
    v_batch_id
  );

  IF coalesce((v_consume->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', coalesce(v_consume->>'error', 'consume_failed'),
      'detail', v_consume
    );
  END IF;

  v_unit_cost := CASE
    WHEN v_total_cost > 0 THEN v_total_cost / p_quantity
    ELSE NULL
  END;

  PERFORM public.adjust_product_stock(
    p_product_id,
    p_quantity,
    'in',
    'intermediate_production',
    v_batch_id,
    v_unit_cost
  );

  RETURN jsonb_build_object(
    'ok', true,
    'batch_id', v_batch_id,
    'recipe_id', v_recipe.id,
    'quantity', p_quantity,
    'unit_cost', v_unit_cost
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'message', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.produce_intermediate_product(UUID, UUID, NUMERIC) IS
  'Produz intermediário: baixa insumos da ficha PRODUCTION e entra a quantidade no produto.';

GRANT EXECUTE ON FUNCTION public.produce_intermediate_product(UUID, UUID, NUMERIC)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.adjust_product_stock(
  p_product_id UUID,
  p_delta DECIMAL,
  p_type TEXT,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_unit_value DECIMAL DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_product_unit TEXT;
  v_old_qty DECIMAL;
  v_old_avg DECIMAL;
  v_last_val DECIMAL;
  v_new_qty DECIMAL;
  v_new_avg DECIMAL;
  v_base_avg DECIMAL;
  v_mov_cost DECIMAL;
  v_metadata JSONB;
  v_sct TEXT;
  v_ref_type TEXT := lower(trim(coalesce(p_reference_type, '')));
  v_mov_type TEXT;
BEGIN
  SELECT p.company_id, NULLIF(btrim(p.unit), ''), p.current_quantity, p.average_cost, p.last_unit_value, p.stock_control_type
  INTO v_company_id, v_product_unit, v_old_qty, v_old_avg, v_last_val, v_sct
  FROM public.products p
  WHERE p.id = p_product_id
  FOR UPDATE;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'product not found: %', p_product_id;
  END IF;

  IF v_sct = 'SALE_FAMILY'
     AND coalesce(p_reference_type, '') IN ('revenue_entry', 'revenue_entry_update') THEN
    RETURN;
  END IF;

  IF p_delta < 0 AND v_ref_type <> 'waste' THEN
    PERFORM public.propagate_recipe_stock_on_output_out(
      p_product_id,
      ABS(p_delta),
      p_reference_type,
      p_reference_id
    );
  END IF;

  v_base_avg := COALESCE(v_old_avg, v_last_val, 0);
  v_new_qty := v_old_qty + p_delta;

  IF p_delta > 0 AND p_unit_value IS NOT NULL THEN
    IF v_new_qty <= 0 THEN
      v_new_avg := v_old_avg;
    ELSIF v_old_qty <= 0 THEN
      v_new_avg := p_unit_value;
    ELSE
      v_new_avg := (v_old_qty * v_base_avg + p_delta * p_unit_value) / v_new_qty;
    END IF;
  ELSE
    v_new_avg := v_old_avg;
  END IF;

  v_mov_cost := CASE
    WHEN p_delta >= 0 THEN p_unit_value
    ELSE NULLIF(v_base_avg, 0)
  END;

  v_metadata := jsonb_build_object(
    'quantity_unit', COALESCE(v_product_unit, 'un')
  );
  IF v_ref_type = 'intermediate_production' THEN
    v_metadata := v_metadata || jsonb_build_object('classification', 'production');
  END IF;

  v_mov_type := CASE
    WHEN p_delta >= 0 THEN 'in'
    WHEN v_ref_type = 'waste' THEN 'waste'
    ELSE 'out'
  END;

  UPDATE public.products SET
    current_quantity = v_new_qty,
    last_unit_value = CASE
      WHEN p_delta > 0 AND p_unit_value IS NOT NULL THEN p_unit_value
      ELSE last_unit_value
    END,
    last_unit_value_stock = CASE
      WHEN p_delta > 0 AND p_unit_value IS NOT NULL THEN p_unit_value
      ELSE last_unit_value_stock
    END,
    last_unit_value_unit_code = CASE
      WHEN p_delta > 0 AND p_unit_value IS NOT NULL THEN COALESCE(v_product_unit, last_unit_value_unit_code, 'un')
      ELSE last_unit_value_unit_code
    END,
    average_cost = CASE
      WHEN p_delta > 0 AND p_unit_value IS NOT NULL THEN v_new_avg
      ELSE average_cost
    END,
    updated_at = NOW()
  WHERE id = p_product_id;

  INSERT INTO public.stock_movements (
    product_id,
    company_id,
    quantity,
    type,
    reference_type,
    reference_id,
    unit_cost,
    metadata_json
  )
  VALUES (
    p_product_id,
    v_company_id,
    ABS(p_delta),
    v_mov_type,
    p_reference_type,
    p_reference_id,
    v_mov_cost,
    v_metadata
  );
END;
$$;

COMMENT ON FUNCTION public.adjust_product_stock(UUID, DECIMAL, TEXT, TEXT, UUID, DECIMAL) IS
  'Ajusta saldo e CMV. Agrupamento ignora venda. Saída de ficha PREP/SALE explode insumos. Produção de intermediário classifica o movimento.';

GRANT EXECUTE ON FUNCTION public.adjust_product_stock(UUID, DECIMAL, TEXT, TEXT, UUID, DECIMAL)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.promote_product_to_sale_family(p_product_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.products
  SET
    stock_control_type = 'SALE_FAMILY',
    listed_in_product_catalog = false,
    composes_cmv = false,
    not_sale_grouping = false,
    updated_at = now()
  WHERE id = p_product_id
    AND stock_control_type IS DISTINCT FROM 'RECIPE_CONTROLLED'
    AND stock_control_type IS DISTINCT FROM 'INTERMEDIATE';
END;
$$;

CREATE OR REPLACE FUNCTION public.link_sale_family_variant(
  p_company_id UUID,
  p_family_product_id UUID,
  p_variant_name TEXT,
  p_variant_sku TEXT DEFAULT NULL,
  p_variant_unit TEXT DEFAULT 'un',
  p_qty_per_sale NUMERIC DEFAULT 1,
  p_variant_product_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_family RECORD;
  v_variant_id UUID;
  v_created BOOLEAN := false;
  v_promoted BOOLEAN := false;
  v_sku TEXT := nullif(btrim(coalesce(p_variant_sku, '')), '');
  v_name TEXT := nullif(btrim(coalesce(p_variant_name, '')), '');
  v_unit TEXT := coalesce(nullif(btrim(coalesce(p_variant_unit, '')), ''), 'un');
  v_qty NUMERIC := coalesce(p_qty_per_sale, 1);
  v_other UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida';
  END IF;
  IF p_company_id IS NULL OR p_family_product_id IS NULL THEN
    RAISE EXCEPTION 'company_id e family_product_id sao obrigatorios';
  END IF;
  IF NOT public.user_has_company_access(v_uid, p_company_id) THEN
    RAISE EXCEPTION 'Sem permissao para esta empresa';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Nome da variante obrigatorio';
  END IF;
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'Proporcao deve ser maior que zero';
  END IF;

  SELECT p.id, p.company_id, p.stock_control_type, p.name
  INTO v_family
  FROM public.products p
  WHERE p.id = p_family_product_id
  FOR UPDATE;

  IF v_family.id IS NULL OR v_family.company_id <> p_company_id THEN
    RAISE EXCEPTION 'Produto do agrupamento nao encontrado';
  END IF;
  IF v_family.stock_control_type IN ('RECIPE_CONTROLLED', 'INTERMEDIATE') THEN
    RAISE EXCEPTION 'Este produto e ficha ou intermediario. Agrupamento e outro cadastro.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.product_sale_family_members m
    WHERE m.variant_product_id = p_family_product_id
  ) THEN
    RAISE EXCEPTION 'Uma variante nao pode virar agrupamento';
  END IF;

  IF v_family.stock_control_type IS DISTINCT FROM 'SALE_FAMILY' THEN
    PERFORM public.promote_product_to_sale_family(p_family_product_id);
    v_promoted := true;
  END IF;

  IF p_variant_product_id IS NOT NULL THEN
    v_variant_id := p_variant_product_id;
    IF NOT EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = v_variant_id AND p.company_id = p_company_id
    ) THEN
      RAISE EXCEPTION 'Variante informada nao encontrada';
    END IF;
  ELSE
    IF v_sku IS NOT NULL THEN
      SELECT p.id INTO v_variant_id
      FROM public.products p
      WHERE p.company_id = p_company_id
        AND p.is_active IS NOT FALSE
        AND btrim(coalesce(p.sku, '')) = v_sku
      ORDER BY p.updated_at DESC
      LIMIT 1;
    END IF;
    IF v_variant_id IS NULL THEN
      SELECT p.id INTO v_variant_id
      FROM public.products p
      WHERE p.company_id = p_company_id
        AND p.is_active IS NOT FALSE
        AND public.normalize_product_match_key(p.name)
          = public.normalize_product_match_key(v_name)
      ORDER BY p.updated_at DESC
      LIMIT 1;
    END IF;
    IF v_variant_id IS NULL THEN
      INSERT INTO public.products (
        company_id, name, sku, unit, current_quantity, min_quantity,
        is_active, stock_control_type, listed_in_product_catalog, composes_cmv
      ) VALUES (
        p_company_id, left(upper(v_name), 512), v_sku, left(v_unit, 32),
        0, 0, true, 'DIRECT', true, true
      )
      RETURNING id INTO v_variant_id;
      v_created := true;
    END IF;
  END IF;

  IF v_variant_id = p_family_product_id THEN
    RAISE EXCEPTION 'A variante nao pode ser o proprio agrupamento';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = v_variant_id AND p.stock_control_type = 'SALE_FAMILY'
  ) THEN
    RAISE EXCEPTION 'Um agrupamento nao pode ser variante de outro';
  END IF;

  SELECT m.family_product_id INTO v_other
  FROM public.product_sale_family_members m
  WHERE m.variant_product_id = v_variant_id
    AND m.family_product_id <> p_family_product_id;
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'Esta variante ja pertence a outro agrupamento';
  END IF;

  INSERT INTO public.product_sale_family_members (
    company_id, family_product_id, variant_product_id, qty_per_sale
  ) VALUES (
    p_company_id, p_family_product_id, v_variant_id, v_qty
  )
  ON CONFLICT (family_product_id, variant_product_id)
  DO UPDATE SET qty_per_sale = excluded.qty_per_sale, updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'family_product_id', p_family_product_id,
    'variant_product_id', v_variant_id,
    'created_variant', v_created,
    'promoted_family', v_promoted,
    'qty_per_sale', v_qty
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_sale_family_variant(UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, UUID)
  TO authenticated, service_role;

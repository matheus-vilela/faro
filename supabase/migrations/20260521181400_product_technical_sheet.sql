-- Ficha técnica no produto: cadastro de insumos + baixa proporcional nos ingredientes quando o prato sai do estoque.

CREATE OR REPLACE FUNCTION public.propagate_recipe_stock_on_output_out(
  p_output_product_id UUID,
  p_out_qty DECIMAL,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipe_id UUID;
  v_consume JSONB;
BEGIN
  IF p_out_qty IS NULL OR p_out_qty <= 0 THEN
    RETURN;
  END IF;

  SELECT r.id
  INTO v_recipe_id
  FROM public.recipes r
  WHERE r.output_product_id = p_output_product_id
    AND r.active IS NOT FALSE
    AND r.recipe_type IN ('PREP', 'SALE')
  ORDER BY r.updated_at DESC
  LIMIT 1;

  IF v_recipe_id IS NULL THEN
    RETURN;
  END IF;

  IF p_reference_type = 'revenue_entry' AND p_reference_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.revenue_entries re
      WHERE re.id = p_reference_id
        AND re.entry_mode = 'recipe_sale'
    ) THEN
      RETURN;
    END IF;
  END IF;

  v_consume := public.consume_recipe_stock(
    v_recipe_id,
    p_out_qty,
    coalesce(nullif(btrim(p_reference_type), ''), 'adjustment'),
    p_reference_id
  )::jsonb;

  IF coalesce((v_consume->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Falha ao baixar insumos da ficha (%).',
      coalesce(v_consume->>'error', 'erro desconhecido');
  END IF;
END;
$$;

COMMENT ON FUNCTION public.propagate_recipe_stock_on_output_out(UUID, DECIMAL, TEXT, UUID) IS
  'Após saída de estoque do produto-prato (PREP/SALE), baixa ingredientes na proporção da ficha.';

GRANT EXECUTE ON FUNCTION public.propagate_recipe_stock_on_output_out(UUID, DECIMAL, TEXT, UUID)
  TO authenticated, service_role;

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
  v_recipe RECORD;
  v_ings JSONB;
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

  IF NOT EXISTS (
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
    AND r.recipe_type IN ('PREP', 'SALE')
    AND r.active IS NOT FALSE
  ORDER BY r.updated_at DESC
  LIMIT 1;

  IF v_recipe.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'recipe', null, 'ingredients', '[]'::jsonb);
  END IF;

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
  SET stock_control_type = 'RECIPE_CONTROLLED', updated_at = now()
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
    'Ficha técnica cadastrada no produto',
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

  RETURN jsonb_build_object(
    'ok', true,
    'recipe_id', v_recipe_id,
    'ingredients_count', v_inserted
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'message', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.upsert_product_technical_sheet(UUID, UUID, JSONB, NUMERIC) IS
  'Cria ou atualiza ficha técnica (PREP) do produto e marca estoque como RECIPE_CONTROLLED.';

GRANT EXECUTE ON FUNCTION public.upsert_product_technical_sheet(UUID, UUID, JSONB, NUMERIC) TO authenticated;

-- Saída do prato: baixa insumos antes de persistir movimento (falha = não altera saldo do prato).
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
BEGIN
  SELECT p.company_id, NULLIF(btrim(p.unit), ''), p.current_quantity, p.average_cost, p.last_unit_value
  INTO v_company_id, v_product_unit, v_old_qty, v_old_avg, v_last_val
  FROM public.products p
  WHERE p.id = p_product_id
  FOR UPDATE;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'product not found: %', p_product_id;
  END IF;

  IF p_delta < 0 THEN
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

  UPDATE public.products SET
    current_quantity = v_new_qty,
    last_unit_value = CASE
      WHEN p_delta > 0 AND p_unit_value IS NOT NULL THEN p_unit_value
      ELSE last_unit_value
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
    CASE WHEN p_delta >= 0 THEN 'in' ELSE 'out' END,
    p_reference_type,
    p_reference_id,
    v_mov_cost,
    v_metadata
  );
END;
$$;

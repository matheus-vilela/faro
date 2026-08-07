-- Correção in-place de movimentação (manual / despesa / breakdown) com ajuste de saldo.

CREATE OR REPLACE FUNCTION public.update_stock_movement(
  p_movement_id UUID,
  p_payload JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_user_name TEXT;
  sm RECORD;
  v_company_id UUID;
  v_old_product_id UUID;
  v_new_product_id UUID;
  v_old_qty DECIMAL;
  v_new_qty DECIMAL;
  v_old_signed DECIMAL;
  v_new_signed DECIMAL;
  v_old_type TEXT;
  v_new_type TEXT;
  v_ref_type TEXT;
  v_meta JSONB;
  v_kind TEXT;
  v_class TEXT;
  v_is_manual BOOLEAN;
  v_is_expense_like BOOLEAN;
  v_unit_cost DECIMAL;
  v_movement_at TIMESTAMPTZ;
  v_input_qty DECIMAL;
  v_input_unit TEXT;
  v_qty_unit TEXT;
  v_product_unit TEXT;
  v_is_purchase_entry BOOLEAN;
  v_old_avg DECIMAL;
  v_last_val DECIMAL;
  v_prod_qty DECIMAL;
  v_base_avg DECIMAL;
  v_new_avg DECIMAL;
BEGIN
  IF p_movement_id IS NULL THEN
    RAISE EXCEPTION 'movement_id required';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'payload required';
  END IF;

  IF v_user_id IS NOT NULL THEN
    SELECT NULLIF(btrim(p.full_name), '')
    INTO v_user_name
    FROM public.profiles p
    WHERE p.id = v_user_id;
  END IF;

  SELECT
    sm0.id,
    sm0.product_id,
    sm0.company_id,
    sm0.quantity,
    sm0.type,
    sm0.reference_type,
    sm0.reference_id,
    sm0.unit_cost,
    sm0.metadata_json,
    sm0.created_at
  INTO sm
  FROM public.stock_movements sm0
  WHERE sm0.id = p_movement_id
  FOR UPDATE;

  IF sm.id IS NULL THEN
    RAISE EXCEPTION 'movement not found';
  END IF;

  v_company_id := sm.company_id;
  IF v_company_id IS NULL THEN
    SELECT p.company_id INTO v_company_id
    FROM public.products p
    WHERE p.id = sm.product_id;
  END IF;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'company not found for movement';
  END IF;

  IF v_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.user_id = v_user_id AND uc.company_id = v_company_id
    ) THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;

  v_ref_type := lower(trim(coalesce(sm.reference_type, '')));
  IF v_ref_type IN ('product_merge', 'product_merge_undo') THEN
    RAISE EXCEPTION 'merge movements cannot be edited';
  END IF;
  IF v_ref_type IN (
    'revenue_entry',
    'revenue_entry_update',
    'revenue_entry_delete'
  ) THEN
    RAISE EXCEPTION 'revenue movements cannot be edited here';
  END IF;

  v_meta := coalesce(sm.metadata_json, '{}'::jsonb);
  v_is_manual := coalesce(v_meta->>'registration_mode', '') IN ('single', 'batch')
    OR (
      v_ref_type IN ('manual', 'waste', 'inventory_count')
      AND coalesce(v_meta->>'movement_kind', '') <> ''
    );

  v_is_expense_like := v_ref_type IN ('expense_item', 'import_breakdown', 'expense');

  IF NOT v_is_manual AND NOT v_is_expense_like THEN
    RAISE EXCEPTION 'movement origin is not editable: %', sm.reference_type;
  END IF;

  v_old_product_id := sm.product_id;
  v_new_product_id := coalesce(
    NULLIF(p_payload->>'product_id', '')::uuid,
    v_old_product_id
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = v_new_product_id AND p.company_id = v_company_id
  ) THEN
    RAISE EXCEPTION 'product not found in company';
  END IF;

  v_old_qty := abs(coalesce(sm.quantity, 0));
  v_old_type := lower(trim(coalesce(sm.type, '')));
  v_old_signed := CASE
    WHEN v_old_type = 'in' THEN v_old_qty
    ELSE -v_old_qty
  END;

  IF p_payload ? 'quantity' AND p_payload->>'quantity' IS NOT NULL THEN
    v_new_qty := abs((p_payload->>'quantity')::decimal);
  ELSE
    v_new_qty := v_old_qty;
  END IF;

  IF v_new_qty <= 0 THEN
    RAISE EXCEPTION 'quantity must be positive';
  END IF;

  v_input_qty := CASE
    WHEN p_payload ? 'input_quantity' AND p_payload->>'input_quantity' IS NOT NULL
      THEN (p_payload->>'input_quantity')::decimal
    WHEN v_meta ? 'input_quantity' THEN NULLIF(v_meta->>'input_quantity', '')::decimal
    ELSE v_new_qty
  END;

  v_input_unit := NULLIF(btrim(coalesce(
    p_payload->>'input_unit_code',
    v_meta->>'input_unit_code',
    ''
  )), '');

  SELECT NULLIF(btrim(p.unit), '')
  INTO v_product_unit
  FROM public.products p
  WHERE p.id = v_new_product_id;

  v_qty_unit := NULLIF(btrim(coalesce(
    p_payload->>'quantity_unit',
    v_input_unit,
    v_meta->>'quantity_unit',
    v_product_unit,
    'un'
  )), '');

  IF v_is_manual THEN
    v_kind := lower(trim(coalesce(
      NULLIF(p_payload->>'movement_kind', ''),
      v_meta->>'movement_kind',
      CASE
        WHEN v_old_type = 'in' THEN 'entry'
        WHEN v_ref_type = 'inventory_count' THEN 'inventory'
        ELSE 'exit'
      END
    )));

    IF v_kind NOT IN ('entry', 'exit', 'inventory') THEN
      RAISE EXCEPTION 'invalid movement kind: %', v_kind;
    END IF;

    v_class := lower(trim(coalesce(
      NULLIF(p_payload->>'classification', ''),
      v_meta->>'classification',
      ''
    )));

    IF v_kind = 'inventory' THEN
      v_class := '';
    ELSIF v_class = '' THEN
      RAISE EXCEPTION 'classification is required';
    ELSIF v_kind = 'entry' AND v_class NOT IN ('purchase', 'production', 'transfer') THEN
      RAISE EXCEPTION 'invalid entry classification: %', v_class;
    ELSIF v_kind = 'exit' AND v_class NOT IN (
      'sale', 'production', 'internal_consumption', 'transfer', 'loss'
    ) THEN
      RAISE EXCEPTION 'invalid exit classification: %', v_class;
    END IF;

    v_new_signed := CASE
      WHEN v_kind = 'entry' THEN v_new_qty
      WHEN v_kind = 'exit' THEN -v_new_qty
      ELSE
        CASE
          WHEN coalesce(v_input_qty, v_new_qty) >= 0 THEN v_new_qty
          ELSE -v_new_qty
        END
    END;

    v_ref_type := CASE
      WHEN v_class = 'loss' THEN 'waste'
      WHEN v_kind = 'inventory' THEN 'inventory_count'
      ELSE 'manual'
    END;

    v_new_type := CASE
      WHEN v_new_signed > 0 THEN 'in'
      WHEN v_ref_type = 'waste' THEN 'waste'
      ELSE 'out'
    END;

    IF p_payload ? 'movement_at' AND NULLIF(p_payload->>'movement_at', '') IS NOT NULL THEN
      v_movement_at := (p_payload->>'movement_at')::timestamptz;
    ELSE
      v_movement_at := sm.created_at;
    END IF;

    IF p_payload ? 'unit_cost' THEN
      IF NULLIF(p_payload->>'unit_cost', '') IS NULL THEN
        v_unit_cost := NULL;
      ELSE
        v_unit_cost := (p_payload->>'unit_cost')::decimal;
      END IF;
    ELSE
      v_unit_cost := sm.unit_cost;
    END IF;

    v_is_purchase_entry := v_kind = 'entry'
      AND v_class = 'purchase'
      AND v_unit_cost IS NOT NULL
      AND v_unit_cost > 0;

    v_meta := v_meta
      || jsonb_build_object(
        'quantity_unit', v_qty_unit,
        'input_quantity', v_input_qty,
        'input_unit_code', v_input_unit,
        'classification', NULLIF(v_class, ''),
        'movement_kind', v_kind,
        'movement_at', v_movement_at,
        'unit_price_input', v_unit_cost
      );
  ELSE
    -- Despesa / breakdown: mantém tipo e referência; só produto / quantidade / unidade.
    v_new_signed := CASE
      WHEN v_old_type = 'in' THEN v_new_qty
      ELSE -v_new_qty
    END;
    v_new_type := sm.type;
    v_movement_at := sm.created_at;
    IF p_payload ? 'unit_cost' AND NULLIF(p_payload->>'unit_cost', '') IS NOT NULL THEN
      v_unit_cost := (p_payload->>'unit_cost')::decimal;
    ELSE
      v_unit_cost := sm.unit_cost;
    END IF;
    v_is_purchase_entry := v_old_type = 'in'
      AND v_ref_type IN ('expense_item', 'import_breakdown')
      AND v_unit_cost IS NOT NULL
      AND v_unit_cost > 0;
    v_meta := v_meta
      || jsonb_build_object(
        'quantity_unit', v_qty_unit,
        'input_quantity', v_input_qty,
        'input_unit_code', v_input_unit
      );
    IF v_ref_type = 'import_breakdown' THEN
      v_meta := v_meta || jsonb_build_object('component_product_id', v_new_product_id);
    END IF;
  END IF;

  v_meta := v_meta || jsonb_build_object(
    'last_edit', jsonb_strip_nulls(jsonb_build_object(
      'at', NOW(),
      'by_user_id', v_user_id,
      'by_name', v_user_name,
      'from_product_id', v_old_product_id,
      'from_quantity', v_old_qty,
      'from_type', sm.type
    ))
  );
  v_meta := jsonb_strip_nulls(v_meta);

  -- Reverte efeito no produto antigo
  SELECT p.current_quantity, p.average_cost, p.last_unit_value
  INTO v_prod_qty, v_old_avg, v_last_val
  FROM public.products p
  WHERE p.id = v_old_product_id
  FOR UPDATE;

  UPDATE public.products SET
    current_quantity = coalesce(v_prod_qty, 0) - v_old_signed,
    updated_at = NOW()
  WHERE id = v_old_product_id;

  -- Aplica no produto novo
  SELECT p.current_quantity, p.average_cost, p.last_unit_value
  INTO v_prod_qty, v_old_avg, v_last_val
  FROM public.products p
  WHERE p.id = v_new_product_id
  FOR UPDATE;

  v_base_avg := coalesce(v_old_avg, v_last_val, 0);
  v_prod_qty := coalesce(v_prod_qty, 0) + v_new_signed;

  IF v_is_purchase_entry AND v_new_signed > 0 THEN
    IF v_prod_qty <= 0 THEN
      v_new_avg := v_old_avg;
    ELSIF coalesce(v_prod_qty, 0) - v_new_signed <= 0 THEN
      v_new_avg := v_unit_cost;
    ELSE
      v_new_avg := (
        (v_prod_qty - v_new_signed) * v_base_avg + v_new_signed * v_unit_cost
      ) / v_prod_qty;
    END IF;
  ELSE
    v_new_avg := v_old_avg;
  END IF;

  UPDATE public.products SET
    current_quantity = v_prod_qty,
    last_unit_value = CASE
      WHEN v_is_purchase_entry AND v_new_signed > 0 THEN v_unit_cost
      ELSE last_unit_value
    END,
    average_cost = CASE
      WHEN v_is_purchase_entry AND v_new_signed > 0 THEN v_new_avg
      ELSE average_cost
    END,
    updated_at = NOW()
  WHERE id = v_new_product_id;

  -- Atualiza lote vinculado (manual) se existir
  IF v_is_manual AND v_old_product_id = v_new_product_id THEN
    UPDATE public.products p
    SET stock_lots = (
      SELECT coalesce(jsonb_agg(
        CASE
          WHEN (elem->>'stock_movement_id') = p_movement_id::text THEN
            elem || jsonb_build_object('quantity', v_new_qty)
          ELSE elem
        END
      ), '[]'::jsonb)
      FROM jsonb_array_elements(coalesce(p.stock_lots, '[]'::jsonb)) elem
    ),
    updated_at = NOW()
    WHERE p.id = v_new_product_id
      AND coalesce(p.stock_lots, '[]'::jsonb) <> '[]'::jsonb;
  END IF;

  UPDATE public.stock_movements SET
    product_id = v_new_product_id,
    company_id = v_company_id,
    quantity = v_new_qty,
    type = v_new_type,
    reference_type = CASE WHEN v_is_manual THEN v_ref_type ELSE sm.reference_type END,
    unit_cost = CASE
      WHEN v_new_signed > 0 THEN v_unit_cost
      ELSE coalesce(v_unit_cost, NULLIF(v_base_avg, 0))
    END,
    metadata_json = v_meta,
    created_at = v_movement_at
  WHERE id = p_movement_id;

  -- Espelha vínculo no item de despesa (entrada direta)
  IF v_ref_type = 'expense_item' AND sm.reference_id IS NOT NULL THEN
    UPDATE public.expense_items ei
    SET
      product_id = v_new_product_id,
      stock_quantity = CASE
        WHEN v_new_signed > 0 THEN v_new_qty
        ELSE ei.stock_quantity
      END
    WHERE ei.id = sm.reference_id
      AND ei.expense_id IN (
        SELECT e.id FROM public.expenses e WHERE e.company_id = v_company_id
      );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'movement_id', p_movement_id,
    'product_id', v_new_product_id,
    'quantity', v_new_qty
  );
END;
$$;

COMMENT ON FUNCTION public.update_stock_movement(UUID, JSONB) IS
  'Atualiza movimentação manual ou de despesa/breakdown in-place e ajusta saldo dos produtos.';

GRANT EXECUTE ON FUNCTION public.update_stock_movement(UUID, JSONB) TO authenticated;

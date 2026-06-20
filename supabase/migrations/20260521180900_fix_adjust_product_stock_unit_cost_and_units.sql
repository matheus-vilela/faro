-- Restaura CMV + unit_cost em stock_movements (regressão em 20260521140000) e grava unidade
-- da quantidade em metadata_json. Corrige custo unitário por unidade de estoque em entradas de NF.

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

COMMENT ON FUNCTION public.adjust_product_stock(UUID, DECIMAL, TEXT, TEXT, UUID, DECIMAL) IS
  'Ajusta saldo, CMV médio, registra movimentação com unit_cost e unidade da quantidade (metadata_json.quantity_unit).';

GRANT EXECUTE ON FUNCTION public.adjust_product_stock(UUID, DECIMAL, TEXT, TEXT, UUID, DECIMAL)
  TO anon, authenticated;

-- Entrada automática XML: custo por unidade de estoque (não por unidade da NF)
CREATE OR REPLACE FUNCTION public.apply_xml_import_direct_stock_for_expense(p_expense_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_row RECORD;
  v_apply NUMERIC;
  v_unit_stock NUMERIC;
  v_applied INTEGER := 0;
BEGIN
  SELECT e.company_id
  INTO v_company_id
  FROM public.expenses e
  WHERE e.id = p_expense_id;

  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expense_not_found');
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.user_id = auth.uid() AND uc.company_id = v_company_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
  END IF;

  FOR v_row IN
    SELECT
      ei.id,
      ei.product_id,
      ei.quantity,
      ei.unit_value,
      ei.stock_quantity,
      ei.stock_added,
      ei.import_pending_resolution,
      ei.import_stock_resolution
    FROM public.expense_items ei
    WHERE ei.expense_id = p_expense_id
  LOOP
    IF v_row.product_id IS NULL THEN
      CONTINUE;
    END IF;
    IF COALESCE(v_row.stock_added, false) THEN
      CONTINUE;
    END IF;
    IF COALESCE(v_row.import_pending_resolution, false) THEN
      CONTINUE;
    END IF;
    IF v_row.import_stock_resolution = 'EXPLODE_BY_RECIPE' THEN
      CONTINUE;
    END IF;

    v_apply := COALESCE(v_row.stock_quantity, v_row.quantity);
    IF v_apply IS NULL OR v_apply <= 0 THEN
      CONTINUE;
    END IF;

    v_unit_stock := v_row.unit_value;
    IF v_row.quantity IS NOT NULL AND v_row.quantity > 0 THEN
      v_unit_stock := (v_row.unit_value * v_row.quantity) / v_apply;
    END IF;

    PERFORM public.adjust_product_stock(
      v_row.product_id,
      v_apply,
      'in',
      'expense_item',
      v_row.id,
      v_unit_stock
    );

    UPDATE public.expense_items
    SET stock_added = true
    WHERE id = v_row.id;

    v_applied := v_applied + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'lines_applied', v_applied);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'message', SQLERRM);
END;
$$;

-- confirmar_recebimento: custo unitário coerente com quantidade em unidade de estoque
CREATE OR REPLACE FUNCTION public.confirmar_recebimento(
  p_token UUID,
  p_items JSONB DEFAULT '[]'::jsonb
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recebimento_id UUID;
  v_status TEXT;
  v_item JSONB;
  v_expense_item_id UUID;
  v_item_status TEXT;
  v_qty_rec NUMERIC;
  v_order_qty NUMERIC;
  v_unit_value NUMERIC;
  v_product_id UUID;
  v_stock_added BOOLEAN;
  v_stock_qty NUMERIC;
  v_stored_qty NUMERIC;
  v_import_stock_resolution TEXT;
  v_resolved_recipe_id UUID;
  v_import_pending_resolution BOOLEAN;
  v_ei_stock_quantity NUMERIC;
  v_import_engine_suggestion TEXT;
  v_import_nature TEXT;
  v_import_confidence NUMERIC;
  v_import_score_reasons JSONB;
  v_company_id UUID;
  v_stock_apply NUMERIC;
  v_unit_cost_stock NUMERIC;
  v_break JSONB;
  v_prev_pending TEXT;
BEGIN
  SELECT r.id, r.status
  INTO v_recebimento_id, v_status
  FROM public.recebimentos r
  WHERE r.token = p_token;

  IF v_recebimento_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Link inválido');
  END IF;

  IF v_status = 'received' THEN
    RETURN json_build_object('success', false, 'error', 'Recebimento já confirmado');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_expense_item_id := (v_item->>'expense_item_id')::UUID;
    v_item_status := COALESCE((v_item->>'status')::TEXT, 'received');
    IF v_item_status NOT IN ('received', 'not_received', 'partial') THEN
      RETURN json_build_object('success', false, 'error', 'Status de item inválido');
    END IF;

    SELECT
      ei.quantity,
      ei.unit_value,
      ei.product_id,
      COALESCE(ei.stock_added, false),
      ei.import_stock_resolution,
      ei.resolved_entry_breakdown_recipe_id,
      ei.import_pending_resolution,
      ei.stock_quantity,
      ei.import_engine_suggestion,
      ei.import_nature,
      ei.import_confidence_0_1,
      ei.import_score_reasons_json,
      e.company_id
    INTO
      v_order_qty,
      v_unit_value,
      v_product_id,
      v_stock_added,
      v_import_stock_resolution,
      v_resolved_recipe_id,
      v_import_pending_resolution,
      v_ei_stock_quantity,
      v_import_engine_suggestion,
      v_import_nature,
      v_import_confidence,
      v_import_score_reasons,
      v_company_id
    FROM public.expense_items ei
    JOIN public.expenses e ON e.id = ei.expense_id
    WHERE ei.id = v_expense_item_id
      AND ei.expense_id = (SELECT expense_id FROM public.recebimentos WHERE id = v_recebimento_id);

    IF v_order_qty IS NULL THEN
      RETURN json_build_object('success', false, 'error', 'Item não pertence a este recebimento');
    END IF;

    IF COALESCE(v_import_pending_resolution, false) = true THEN
      RETURN json_build_object(
        'success', false,
        'error',
        'Existem itens pendentes de resolução de importação. Conclua a conferência antes de confirmar o recebimento.'
      );
    END IF;

    v_qty_rec := NULL;
    IF (v_item->>'quantity_received') IS NOT NULL AND length(trim(v_item->>'quantity_received')) > 0 THEN
      v_qty_rec := (v_item->>'quantity_received')::NUMERIC;
    END IF;

    IF v_item_status = 'received' THEN
      v_stored_qty := v_order_qty;
      v_stock_qty := v_order_qty;
    ELSIF v_item_status = 'not_received' THEN
      v_stored_qty := 0;
      v_stock_qty := 0;
    ELSE
      IF v_qty_rec IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Informe a quantidade recebida para itens parciais');
      END IF;
      IF v_qty_rec <= 0 THEN
        RETURN json_build_object('success', false, 'error', 'Quantidade recebida deve ser maior que zero');
      END IF;
      IF v_qty_rec > v_order_qty THEN
        RETURN json_build_object(
          'success', false,
          'error', 'Quantidade recebida não pode ser maior que a quantidade pedida.'
        );
      END IF;
      IF v_qty_rec >= v_order_qty THEN
        v_item_status := 'received';
        v_stored_qty := v_order_qty;
        v_stock_qty := v_order_qty;
      ELSE
        v_stored_qty := v_qty_rec;
        v_stock_qty := v_qty_rec;
      END IF;
    END IF;

    INSERT INTO public.recebimento_item_status (
      recebimento_id,
      expense_item_id,
      status,
      quantity_received
    )
    VALUES (
      v_recebimento_id,
      v_expense_item_id,
      v_item_status,
      v_stored_qty
    )
    ON CONFLICT (recebimento_id, expense_item_id) DO UPDATE SET
      status = EXCLUDED.status,
      quantity_received = EXCLUDED.quantity_received;

    IF v_stock_qty > 0 AND NOT v_stock_added THEN
      v_prev_pending := COALESCE(v_import_engine_suggestion, '');
      IF v_import_stock_resolution = 'EXPLODE_BY_RECIPE'
         AND v_resolved_recipe_id IS NOT NULL
      THEN
        v_break := public.apply_entry_breakdown_stock_for_expense_item(
          v_expense_item_id,
          v_stock_qty,
          v_resolved_recipe_id
        );
        IF COALESCE((v_break->>'ok')::boolean, false) IS NOT TRUE THEN
          RETURN json_build_object(
            'success', false,
            'error',
            COALESCE(v_break->>'error', 'Falha na explosão por ficha'),
            'detail', v_break
          );
        END IF;
        INSERT INTO public.import_item_resolution_audit_logs (
          company_id,
          expense_item_id,
          previous_status,
          new_status,
          applied_resolution_mode,
          applied_rule_id,
          applied_recipe_id,
          recipe_version,
          user_id,
          score_reasons_json
        ) VALUES (
          v_company_id,
          v_expense_item_id,
          v_prev_pending,
          'APPLIED_EXPLODE',
          'EXPLODE_BY_RECIPE',
          NULL,
          v_resolved_recipe_id,
          (SELECT version FROM public.recipes WHERE id = v_resolved_recipe_id),
          auth.uid(),
          v_import_score_reasons
        );
        UPDATE public.expense_items SET stock_added = true WHERE id = v_expense_item_id;
      ELSIF v_product_id IS NOT NULL THEN
        v_stock_apply := COALESCE(v_ei_stock_quantity, v_order_qty)
          * (v_stock_qty / NULLIF(v_order_qty, 0));
        v_unit_cost_stock := v_unit_value;
        IF v_stock_apply > 0 AND v_stored_qty > 0 THEN
          v_unit_cost_stock := (v_unit_value * v_stored_qty) / v_stock_apply;
        END IF;
        PERFORM public.adjust_product_stock(
          v_product_id,
          v_stock_apply,
          'in',
          'expense_item',
          v_expense_item_id,
          v_unit_cost_stock
        );
        INSERT INTO public.import_item_resolution_audit_logs (
          company_id,
          expense_item_id,
          previous_status,
          new_status,
          applied_resolution_mode,
          applied_rule_id,
          applied_recipe_id,
          recipe_version,
          user_id,
          score_reasons_json
        ) VALUES (
          v_company_id,
          v_expense_item_id,
          v_prev_pending,
          'APPLIED_DIRECT',
          'DIRECT',
          NULL,
          NULL,
          NULL,
          auth.uid(),
          v_import_score_reasons
        );
        UPDATE public.expense_items SET stock_added = true WHERE id = v_expense_item_id;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.recebimentos SET
    status = 'received',
    received_at = NOW()
  WHERE token = p_token;

  RETURN json_build_object('success', true);
END;
$$;

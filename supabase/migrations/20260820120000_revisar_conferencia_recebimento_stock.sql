-- Gestor pode revisar conferência já confirmada. Estorna e reaplica estoque
-- (entrada direta ou explosão) sem disparar baixa de ficha técnica.

CREATE OR REPLACE FUNCTION public.recebimento_clear_item_stock(p_expense_item_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_net NUMERIC;
  v_company_id UUID;
BEGIN
  IF p_expense_item_id IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT
      sm.product_id,
      SUM(
        CASE
          WHEN sm.type = 'in' THEN sm.quantity
          ELSE -sm.quantity
        END
      ) AS net_qty
    FROM public.stock_movements sm
    WHERE sm.reference_id = p_expense_item_id
      AND sm.reference_type IN (
        'expense_item',
        'import_breakdown',
        'recebimento_revision'
      )
    GROUP BY sm.product_id
    HAVING SUM(
      CASE
        WHEN sm.type = 'in' THEN sm.quantity
        ELSE -sm.quantity
      END
    ) IS DISTINCT FROM 0
  LOOP
    v_net := r.net_qty;
    IF v_net = 0 THEN
      CONTINUE;
    END IF;

    SELECT p.company_id
    INTO v_company_id
    FROM public.products p
    WHERE p.id = r.product_id
    FOR UPDATE;

    IF v_company_id IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE public.products
    SET
      current_quantity = current_quantity - v_net,
      updated_at = NOW()
    WHERE id = r.product_id;

    INSERT INTO public.stock_movements (
      product_id,
      company_id,
      quantity,
      type,
      reference_type,
      reference_id,
      metadata_json
    )
    VALUES (
      r.product_id,
      v_company_id,
      ABS(v_net),
      CASE WHEN v_net > 0 THEN 'out' ELSE 'in' END,
      'recebimento_revision',
      p_expense_item_id,
      jsonb_build_object('reason', 'conference_edit')
    );
  END LOOP;

  UPDATE public.expense_items
  SET stock_added = false
  WHERE id = p_expense_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.recebimento_apply_item_stock(
  p_expense_item_id UUID,
  p_received_line_qty NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_qty NUMERIC;
  v_unit_value NUMERIC;
  v_product_id UUID;
  v_import_stock_resolution TEXT;
  v_resolved_recipe_id UUID;
  v_ei_stock_quantity NUMERIC;
  v_import_engine_suggestion TEXT;
  v_import_score_reasons JSONB;
  v_company_id UUID;
  v_stock_apply NUMERIC;
  v_unit_cost_stock NUMERIC;
  v_break JSONB;
  v_prev_pending TEXT;
BEGIN
  IF p_expense_item_id IS NULL OR COALESCE(p_received_line_qty, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true);
  END IF;

  SELECT
    ei.quantity,
    ei.unit_value,
    ei.product_id,
    ei.import_stock_resolution,
    ei.resolved_entry_breakdown_recipe_id,
    ei.stock_quantity,
    ei.import_engine_suggestion,
    ei.import_score_reasons_json,
    e.company_id
  INTO
    v_order_qty,
    v_unit_value,
    v_product_id,
    v_import_stock_resolution,
    v_resolved_recipe_id,
    v_ei_stock_quantity,
    v_import_engine_suggestion,
    v_import_score_reasons,
    v_company_id
  FROM public.expense_items ei
  JOIN public.expenses e ON e.id = ei.expense_id
  WHERE ei.id = p_expense_item_id;

  IF v_order_qty IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Item não encontrado');
  END IF;

  v_prev_pending := COALESCE(v_import_engine_suggestion, '');

  IF v_import_stock_resolution = 'EXPLODE_BY_RECIPE'
     AND v_resolved_recipe_id IS NOT NULL
  THEN
    v_break := public.apply_entry_breakdown_stock_for_expense_item(
      p_expense_item_id,
      p_received_line_qty,
      v_resolved_recipe_id
    );
    IF COALESCE((v_break->>'ok')::boolean, false) IS NOT TRUE THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', COALESCE(v_break->>'error', 'Falha na explosão por ficha'),
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
      p_expense_item_id,
      v_prev_pending,
      'APPLIED_EXPLODE',
      'EXPLODE_BY_RECIPE',
      NULL,
      v_resolved_recipe_id,
      (SELECT version FROM public.recipes WHERE id = v_resolved_recipe_id),
      auth.uid(),
      v_import_score_reasons
    );
    UPDATE public.expense_items SET stock_added = true WHERE id = p_expense_item_id;
    RETURN jsonb_build_object('ok', true, 'mode', 'explode');
  END IF;

  IF v_product_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true);
  END IF;

  v_stock_apply := COALESCE(v_ei_stock_quantity, v_order_qty)
    * (p_received_line_qty / NULLIF(v_order_qty, 0));
  v_unit_cost_stock := v_unit_value;
  IF v_stock_apply > 0 AND p_received_line_qty > 0 THEN
    v_unit_cost_stock := (v_unit_value * p_received_line_qty) / v_stock_apply;
  END IF;

  PERFORM public.adjust_product_stock(
    v_product_id,
    v_stock_apply,
    'in',
    'expense_item',
    p_expense_item_id,
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
    p_expense_item_id,
    v_prev_pending,
    'APPLIED_DIRECT',
    'DIRECT',
    NULL,
    NULL,
    NULL,
    auth.uid(),
    v_import_score_reasons
  );
  UPDATE public.expense_items SET stock_added = true WHERE id = p_expense_item_id;
  RETURN jsonb_build_object('ok', true, 'mode', 'direct');
END;
$$;

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
  v_company_id UUID;
  v_item JSONB;
  v_expense_item_id UUID;
  v_item_status TEXT;
  v_qty_rec NUMERIC;
  v_order_qty NUMERIC;
  v_import_pending_resolution BOOLEAN;
  v_stored_qty NUMERIC;
  v_apply JSONB;
BEGIN
  SELECT r.id, r.status, r.company_id
  INTO v_recebimento_id, v_status, v_company_id
  FROM public.recebimentos r
  WHERE r.token = p_token;

  IF v_recebimento_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Link inválido');
  END IF;

  IF v_status = 'received' THEN
    IF auth.uid() IS NULL THEN
      RETURN json_build_object('success', false, 'error', 'Recebimento já confirmado');
    END IF;
    IF NOT (
      public.is_platform_admin()
      OR EXISTS (
        SELECT 1 FROM public.user_companies uc
        WHERE uc.user_id = auth.uid() AND uc.company_id = v_company_id
      )
    ) THEN
      RETURN json_build_object('success', false, 'error', 'Sem permissão para revisar a conferência');
    END IF;
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
      ei.import_pending_resolution
    INTO v_order_qty, v_import_pending_resolution
    FROM public.expense_items ei
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
    ELSIF v_item_status = 'not_received' THEN
      v_stored_qty := 0;
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
      ELSE
        v_stored_qty := v_qty_rec;
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

    PERFORM public.recebimento_clear_item_stock(v_expense_item_id);
    v_apply := public.recebimento_apply_item_stock(v_expense_item_id, v_stored_qty);
    IF COALESCE((v_apply->>'ok')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION '%', COALESCE(v_apply->>'error', 'Falha ao ajustar estoque');
    END IF;
  END LOOP;

  UPDATE public.recebimentos SET
    status = 'received',
    received_at = COALESCE(received_at, NOW())
  WHERE token = p_token;

  RETURN json_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.recebimento_clear_item_stock(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recebimento_apply_item_stock(UUID, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recebimento_clear_item_stock(UUID) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.recebimento_apply_item_stock(UUID, NUMERIC) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.confirmar_recebimento(UUID, JSONB) TO anon, authenticated;

COMMENT ON FUNCTION public.confirmar_recebimento(UUID, JSONB) IS
  'Confirma ou revisa conferência. Operador (anon) só na primeira vez; gestor autenticado pode alterar e o estoque é estornado/reaplicado.';

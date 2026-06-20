-- Remove tabelas sem uso no app (catálogo alias, unidades legadas, rascunhos de receita IA,
-- regras de resolução de importação). Mantém import_item_resolution_audit_logs (confirmar_recebimento).

-- ---------------------------------------------------------------------------
-- 1) merge_onboarding_products sem tabelas que serão removidas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_onboarding_products(
  p_company_id UUID,
  p_winner_id UUID,
  p_loser_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_win_company UUID;
  v_lose_company UUID;
  v_qty_win NUMERIC;
  v_qty_lose NUMERIC;
BEGIN
  IF p_winner_id = p_loser_id THEN
    RETURN;
  END IF;

  SELECT company_id, current_quantity INTO v_win_company, v_qty_win
  FROM public.products WHERE id = p_winner_id FOR UPDATE;
  SELECT company_id, current_quantity INTO v_lose_company, v_qty_lose
  FROM products WHERE id = p_loser_id FOR UPDATE;

  IF v_win_company IS NULL OR v_lose_company IS NULL THEN
    RAISE EXCEPTION 'Produto não encontrado';
  END IF;
  IF v_win_company <> p_company_id OR v_lose_company <> p_company_id THEN
    RAISE EXCEPTION 'Produtos não pertencem à empresa informada';
  END IF;

  DELETE FROM public.product_operational_config
  WHERE company_id = p_company_id AND product_id = p_loser_id;

  DELETE FROM public.product_category_assignments WHERE product_id = p_loser_id;

  UPDATE public.product_import_equivalences SET product_id = p_winner_id, updated_at = NOW()
  WHERE product_id = p_loser_id;

  DELETE FROM public.product_unit_rules r
  WHERE r.product_id = p_loser_id
    AND EXISTS (
      SELECT 1 FROM public.product_unit_rules w
      WHERE w.company_id = r.company_id AND w.product_id = p_winner_id
        AND w.from_unit_normalized = r.from_unit_normalized
    );

  UPDATE public.product_unit_rules SET product_id = p_winner_id, updated_at = NOW()
  WHERE product_id = p_loser_id;

  DELETE FROM public.product_invoice_line_aliases l
  WHERE l.product_id = p_loser_id
    AND EXISTS (
      SELECT 1 FROM public.product_invoice_line_aliases w
      WHERE w.company_id = l.company_id AND w.product_id = p_winner_id
        AND w.normalized_label = l.normalized_label
    );

  UPDATE public.product_invoice_line_aliases SET product_id = p_winner_id
  WHERE product_id = p_loser_id;

  UPDATE public.expense_items SET product_id = p_winner_id WHERE product_id = p_loser_id;
  UPDATE public.stock_movements SET product_id = p_winner_id WHERE product_id = p_loser_id;
  UPDATE public.revenue_entries SET product_id = p_winner_id WHERE product_id = p_loser_id;

  UPDATE public.purchase_order_items SET product_id = p_winner_id WHERE product_id = p_loser_id;

  DELETE FROM public.product_unit_conversions c
  WHERE c.product_id = p_loser_id
    AND EXISTS (
      SELECT 1 FROM public.product_unit_conversions w
      WHERE w.product_id = p_winner_id
        AND w.secondary_unit_code = c.secondary_unit_code
    );

  UPDATE public.product_unit_conversions SET product_id = p_winner_id
  WHERE product_id = p_loser_id;

  UPDATE public.inventory_count_listings SET product_id = p_winner_id WHERE product_id = p_loser_id;

  DELETE FROM public.recipe_ingredients ri
  WHERE ri.product_id = p_loser_id
    AND EXISTS (
      SELECT 1 FROM public.recipe_ingredients z
      WHERE z.recipe_id = ri.recipe_id AND z.product_id = p_winner_id
    );

  UPDATE public.recipe_ingredients SET product_id = p_winner_id WHERE product_id = p_loser_id;

  UPDATE public.recipes SET output_product_id = p_winner_id
  WHERE output_product_id = p_loser_id;

  UPDATE public.products SET
    current_quantity = COALESCE(v_qty_win, 0) + COALESCE(v_qty_lose, 0),
    updated_at = NOW()
  WHERE id = p_winner_id;

  DELETE FROM public.products WHERE id = p_loser_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) RPCs de rascunho de receita (UI nunca integrou)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.submit_import_recipe_draft_feedback_for_recebimento(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.reject_import_recipe_draft_for_recebimento(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS public.update_import_recipe_draft_for_recebimento(UUID, UUID, JSONB, NUMERIC, JSONB);
DROP FUNCTION IF EXISTS public.approve_import_recipe_draft_for_recebimento(UUID, UUID, TEXT, NUMERIC, UUID);
DROP FUNCTION IF EXISTS public.get_import_recipe_draft_for_recebimento(UUID, UUID);

DROP TABLE IF EXISTS public.import_recipe_draft_components;
DROP TABLE IF EXISTS public.import_recipe_drafts;

-- ---------------------------------------------------------------------------
-- 3) Regras de resolução (só upsert legado; auditoria permanece)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.upsert_import_item_resolution_rule(
  UUID, UUID, TEXT, TEXT, UUID, UUID, BOOLEAN, TEXT, TEXT
);

-- confirmar_recebimento: remove referência a import_applied_rule_id (coluna legada)
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
        PERFORM public.adjust_product_stock(
          v_product_id,
          v_stock_apply,
          'in',
          'expense_item',
          v_expense_item_id,
          v_unit_value
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

ALTER TABLE public.expense_items
  DROP CONSTRAINT IF EXISTS expense_items_import_applied_rule_id_fkey;

ALTER TABLE public.expense_items
  DROP COLUMN IF EXISTS import_applied_rule_id;

ALTER TABLE public.import_item_resolution_audit_logs
  DROP CONSTRAINT IF EXISTS import_item_resolution_audit_logs_applied_rule_id_fkey;

DROP TABLE IF EXISTS public.import_item_resolution_rules;

-- ---------------------------------------------------------------------------
-- 4) Catálogo mestre: aliases não consultados no app
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.master_item_alias;

-- ---------------------------------------------------------------------------
-- 5) Unidades por empresa (substituídas por códigos em product_unit_conversions)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.company_unit_conversions;
DROP TABLE IF EXISTS public.company_units;

DROP FUNCTION IF EXISTS public.touch_company_units_updated_at();
DROP FUNCTION IF EXISTS public.enforce_company_unit_conversion_primary();

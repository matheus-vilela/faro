-- Onboarding XML: marcar linhas de recebimento como "received" quando o vínculo de
-- produto está pronto e não há bloqueio de import (mesmo que `stock_added` ainda
-- não tenha sido persistido no mesmo instante), alinhando o card de Recebimentos.

CREATE OR REPLACE FUNCTION public.finalize_onboarding_xml_recebimento_for_expense(p_expense_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_rec_id UUID;
  v_rec_status TEXT;
  v_row RECORD;
  v_item_status TEXT;
  v_qty_rec NUMERIC;
  v_synced INTEGER := 0;
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

  IF NOT EXISTS (
    SELECT 1
    FROM public.onboarding_import_item_raw o
    INNER JOIN public.expense_items ei ON ei.id = o.expense_item_id
    INNER JOIN public.expenses e ON e.id = ei.expense_id
    WHERE e.id = p_expense_id
      AND o.company_id = e.company_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_onboarding_xml_expense');
  END IF;

  SELECT r.id, r.status
  INTO v_rec_id, v_rec_status
  FROM public.recebimentos r
  WHERE r.expense_id = p_expense_id
  LIMIT 1;

  IF v_rec_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recebimento_not_found');
  END IF;

  IF v_rec_status = 'received' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'already_received');
  END IF;

  FOR v_row IN
    SELECT
      ei.id,
      ei.quantity,
      ei.stock_quantity,
      ei.product_id,
      COALESCE(ei.stock_added, false) AS stock_added,
      COALESCE(ei.import_pending_resolution, false) AS import_pending_resolution,
      ei.import_stock_resolution
    FROM public.expense_items ei
    WHERE ei.expense_id = p_expense_id
  LOOP
    IF v_row.product_id IS NULL OR COALESCE(v_row.quantity, 0) <= 0 THEN
      v_item_status := 'not_received';
      v_qty_rec := 0::numeric;
    ELSIF COALESCE(v_row.stock_added, false) THEN
      v_item_status := 'received';
      v_qty_rec := COALESCE(v_row.stock_quantity, v_row.quantity);
    ELSIF
      NOT v_row.import_pending_resolution
      AND (
        v_row.import_stock_resolution IS NULL
        OR v_row.import_stock_resolution IS DISTINCT FROM 'EXPLODE_BY_RECIPE'
      )
    THEN
      v_item_status := 'received';
      v_qty_rec := COALESCE(v_row.stock_quantity, v_row.quantity);
    ELSE
      v_item_status := 'not_received';
      v_qty_rec := 0::numeric;
    END IF;

    INSERT INTO public.recebimento_item_status (
      recebimento_id,
      expense_item_id,
      status,
      quantity_received
    )
    VALUES (
      v_rec_id,
      v_row.id,
      v_item_status,
      v_qty_rec
    )
    ON CONFLICT (recebimento_id, expense_item_id) DO UPDATE SET
      status = EXCLUDED.status,
      quantity_received = EXCLUDED.quantity_received;

    v_synced := v_synced + 1;
  END LOOP;

  UPDATE public.recebimentos
  SET
    status = 'received',
    received_at = now()
  WHERE id = v_rec_id;

  RETURN jsonb_build_object('ok', true, 'items_synced', v_synced);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'message', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.finalize_onboarding_xml_recebimento_for_expense(UUID) IS
  'Onboarding XML: marca recebimento como concluído e sincroniza status por linha (stock aplicado OU catálogo/import sem pendência, exceto EXPLODE_BY_RECIPE).';

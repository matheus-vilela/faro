-- Observações por item na conferência (parcial / não recebido).

ALTER TABLE public.recebimento_item_status
  ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN public.recebimento_item_status.notes IS
  'Observação do conferente quando o item chega parcial ou não chega.';

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
  v_notes TEXT;
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
        'Há itens sem vínculo de estoque. Abra o detalhe da nota para vincular o produto e a conversão de unidade, depois confirme o recebimento.'
      );
    END IF;

    v_qty_rec := NULL;
    IF (v_item->>'quantity_received') IS NOT NULL AND length(trim(v_item->>'quantity_received')) > 0 THEN
      v_qty_rec := (v_item->>'quantity_received')::NUMERIC;
    END IF;

    v_notes := NULLIF(btrim(COALESCE(v_item->>'notes', '')), '');
    IF v_item_status = 'received' THEN
      v_notes := NULL;
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
        v_notes := NULL;
      ELSE
        v_stored_qty := v_qty_rec;
      END IF;
    END IF;

    INSERT INTO public.recebimento_item_status (
      recebimento_id,
      expense_item_id,
      status,
      quantity_received,
      notes
    )
    VALUES (
      v_recebimento_id,
      v_expense_item_id,
      v_item_status,
      v_stored_qty,
      v_notes
    )
    ON CONFLICT (recebimento_id, expense_item_id) DO UPDATE SET
      status = EXCLUDED.status,
      quantity_received = EXCLUDED.quantity_received,
      notes = EXCLUDED.notes;

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

GRANT EXECUTE ON FUNCTION public.confirmar_recebimento(UUID, JSONB) TO anon, authenticated;

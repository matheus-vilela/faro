-- Recebimento parcial: status 'partial' + quantity_received; alertas com quantidade faltante

ALTER TABLE public.recebimento_item_status
  DROP CONSTRAINT IF EXISTS recebimento_item_status_status_check;

ALTER TABLE public.recebimento_item_status
  ADD COLUMN IF NOT EXISTS quantity_received NUMERIC;

ALTER TABLE public.recebimento_item_status
  ADD CONSTRAINT recebimento_item_status_status_check
  CHECK (status IN ('received', 'not_received', 'partial'));

COMMENT ON COLUMN public.recebimento_item_status.quantity_received IS
  'Quantidade efetivamente recebida: not_received=0; received=total da linha; partial entre 0 e o pedido.';

-- Backfill linhas antigas
UPDATE public.recebimento_item_status ris
SET quantity_received = ei.quantity
FROM public.expense_items ei
WHERE ris.expense_item_id = ei.id
  AND ris.status = 'received'
  AND ris.quantity_received IS NULL;

UPDATE public.recebimento_item_status
SET quantity_received = 0
WHERE status = 'not_received'
  AND quantity_received IS NULL;

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

    SELECT ei.quantity, ei.unit_value, ei.product_id, COALESCE(ei.stock_added, false)
    INTO v_order_qty, v_unit_value, v_product_id, v_stock_added
    FROM public.expense_items ei
    WHERE ei.id = v_expense_item_id
      AND ei.expense_id = (SELECT expense_id FROM public.recebimentos WHERE id = v_recebimento_id);

    IF v_order_qty IS NULL THEN
      RETURN json_build_object('success', false, 'error', 'Item não pertence a este recebimento');
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
      -- partial
      IF v_qty_rec IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'Informe a quantidade recebida para itens parciais');
      END IF;
      IF v_qty_rec <= 0 THEN
        RETURN json_build_object('success', false, 'error', 'Quantidade recebida deve ser maior que zero');
      END IF;
      IF v_qty_rec >= v_order_qty THEN
        -- tratar como recebimento total
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

    IF v_stock_qty > 0
       AND v_product_id IS NOT NULL
       AND NOT v_stock_added
    THEN
      PERFORM public.adjust_product_stock(
        v_product_id,
        v_stock_qty,
        'in',
        'expense_item',
        v_expense_item_id,
        v_unit_value
      );
      UPDATE public.expense_items SET stock_added = true WHERE id = v_expense_item_id;
    END IF;
  END LOOP;

  UPDATE public.recebimentos SET
    status = 'received',
    received_at = NOW()
  WHERE token = p_token;

  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirmar_recebimento(UUID, JSONB) TO anon, authenticated;

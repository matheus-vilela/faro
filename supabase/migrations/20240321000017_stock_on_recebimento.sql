-- Atualizar estoque na confirmação do recebimento (não mais ao cadastrar nota)
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
  v_product_id UUID;
  v_quantity DECIMAL;
  v_unit_value DECIMAL;
BEGIN
  SELECT id, status INTO v_recebimento_id, v_status
  FROM recebimentos
  WHERE token = p_token;

  IF v_recebimento_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Link inválido');
  END IF;

  IF v_status = 'received' THEN
    RETURN json_build_object('success', false, 'error', 'Recebimento já confirmado');
  END IF;

  -- Inserir status de cada item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_expense_item_id := (v_item->>'expense_item_id')::UUID;
    v_item_status := COALESCE((v_item->>'status')::TEXT, 'received');

    INSERT INTO recebimento_item_status (recebimento_id, expense_item_id, status)
    VALUES (v_recebimento_id, v_expense_item_id, v_item_status)
    ON CONFLICT (recebimento_id, expense_item_id) DO UPDATE SET status = EXCLUDED.status;

    -- Atualizar estoque apenas para itens recebidos com produto vinculado
    IF v_item_status = 'received' THEN
      SELECT ei.product_id, ei.quantity, ei.unit_value
      INTO v_product_id, v_quantity, v_unit_value
      FROM expense_items ei
      WHERE ei.id = v_expense_item_id
        AND ei.expense_id = (SELECT expense_id FROM recebimentos WHERE id = v_recebimento_id)
        AND ei.product_id IS NOT NULL
        AND COALESCE(ei.stock_added, false) = false;

      IF v_product_id IS NOT NULL AND v_quantity IS NOT NULL AND v_quantity > 0 THEN
        PERFORM adjust_product_stock(
          v_product_id,
          v_quantity,
          'in',
          'expense_item',
          v_expense_item_id,
          v_unit_value
        );
        UPDATE expense_items SET stock_added = true WHERE id = v_expense_item_id;
      END IF;
    END IF;
  END LOOP;

  UPDATE recebimentos SET
    status = 'received',
    received_at = NOW()
  WHERE token = p_token;

  RETURN json_build_object('success', true);
END;
$$;

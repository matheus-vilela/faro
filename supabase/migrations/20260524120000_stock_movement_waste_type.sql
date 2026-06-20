-- Perdas: baixa direta do produto (sem explosão de ficha) e tipo de movimentação 'waste'.

ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_type_check;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_type_check
  CHECK (type IN ('in', 'out', 'adjustment', 'waste'));

UPDATE public.stock_movements
SET type = 'waste'
WHERE reference_type = 'waste'
  AND type = 'out';

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
  v_ref_type TEXT := lower(trim(coalesce(p_reference_type, '')));
  v_is_expense_purchase BOOLEAN;
  v_mov_type TEXT;
BEGIN
  SELECT p.company_id, NULLIF(btrim(p.unit), ''), p.current_quantity, p.average_cost, p.last_unit_value
  INTO v_company_id, v_product_unit, v_old_qty, v_old_avg, v_last_val
  FROM public.products p
  WHERE p.id = p_product_id
  FOR UPDATE;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'product not found: %', p_product_id;
  END IF;

  v_is_expense_purchase := p_delta > 0
    AND p_unit_value IS NOT NULL
    AND v_ref_type IN ('expense_item', 'import_breakdown');

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

  IF v_is_expense_purchase THEN
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

  v_mov_type := CASE
    WHEN p_delta >= 0 THEN 'in'
    WHEN v_ref_type = 'waste' THEN 'waste'
    ELSE 'out'
  END;

  UPDATE public.products SET
    current_quantity = v_new_qty,
    last_unit_value = CASE
      WHEN v_is_expense_purchase THEN p_unit_value
      ELSE last_unit_value
    END,
    average_cost = CASE
      WHEN v_is_expense_purchase THEN v_new_avg
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
  'Ajusta saldo e CMV. Perdas (waste) baixam só o produto informado, sem explosão de ficha.';

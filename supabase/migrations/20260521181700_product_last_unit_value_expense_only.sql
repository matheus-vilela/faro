-- Último preço unitário e CMV médio só refletem compras (despesa / explosão de NF).
-- Vendas, estornos de venda, contagem e ajustes não sobrescrevem last_unit_value.

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
    CASE WHEN p_delta >= 0 THEN 'in' ELSE 'out' END,
    p_reference_type,
    p_reference_id,
    v_mov_cost,
    v_metadata
  );
END;
$$;

COMMENT ON FUNCTION public.adjust_product_stock(UUID, DECIMAL, TEXT, TEXT, UUID, DECIMAL) IS
  'Ajusta saldo e CMV. last_unit_value e average_cost só mudam em entradas de despesa (expense_item, import_breakdown).';

-- Corrige cadastro onde o último preço não veio de compra (ex.: dado legado de venda).
WITH last_expense_in AS (
  SELECT DISTINCT ON (sm.product_id)
    sm.product_id,
    sm.unit_cost
  FROM public.stock_movements sm
  WHERE sm.type = 'in'
    AND lower(trim(coalesce(sm.reference_type, ''))) IN ('expense_item', 'import_breakdown')
    AND sm.unit_cost IS NOT NULL
    AND sm.unit_cost > 0
  ORDER BY sm.product_id, sm.created_at DESC
)
UPDATE public.products p
SET
  last_unit_value = lei.unit_cost,
  updated_at = now()
FROM last_expense_in lei
WHERE p.id = lei.product_id;

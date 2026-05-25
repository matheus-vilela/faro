-- Lotes com validade em products.stock_lots (JSONB). Sem tabela auxiliar.
-- Entrada manual com validade grava lote + metadata_json na movimentação.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock_lots JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.products.stock_lots IS
  'Lotes com validade: [{id, quantity, expiry_date, stock_movement_id?, created_at?}]. Cadastro manual no produto ou via movimentação de entrada.';

CREATE OR REPLACE FUNCTION public.register_manual_stock_movement(
  p_product_id UUID,
  p_movement_kind TEXT,
  p_classification TEXT DEFAULT NULL,
  p_delta DECIMAL DEFAULT NULL,
  p_input_quantity DECIMAL DEFAULT NULL,
  p_input_unit_code TEXT DEFAULT NULL,
  p_unit_price_stock DECIMAL DEFAULT NULL,
  p_movement_at TIMESTAMPTZ DEFAULT NOW(),
  p_expiry_date DATE DEFAULT NULL
)
RETURNS UUID
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
  v_kind TEXT := lower(trim(coalesce(p_movement_kind, '')));
  v_class TEXT := lower(trim(coalesce(p_classification, '')));
  v_ref_type TEXT;
  v_mov_type TEXT;
  v_movement_id UUID;
  v_is_purchase_entry BOOLEAN;
  v_lot_entry JSONB;
  v_user_id UUID;
  v_user_name TEXT;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NOT NULL THEN
    SELECT NULLIF(btrim(p.full_name), '')
    INTO v_user_name
    FROM public.profiles p
    WHERE p.id = v_user_id;
  END IF;

  IF v_kind NOT IN ('entry', 'exit', 'inventory') THEN
    RAISE EXCEPTION 'invalid movement kind: %', p_movement_kind;
  END IF;

  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'quantity must be non-zero';
  END IF;

  IF v_kind = 'entry' AND p_delta <= 0 THEN
    RAISE EXCEPTION 'entry movement requires positive quantity';
  END IF;

  IF v_kind = 'exit' AND p_delta >= 0 THEN
    RAISE EXCEPTION 'exit movement requires negative quantity';
  END IF;

  IF v_kind = 'inventory' AND p_classification IS NOT NULL AND btrim(p_classification) <> '' THEN
    RAISE EXCEPTION 'inventory movement cannot have classification';
  END IF;

  IF v_kind IN ('entry', 'exit') THEN
    IF v_class = '' THEN
      RAISE EXCEPTION 'classification is required';
    END IF;
    IF v_kind = 'entry' AND v_class NOT IN ('purchase', 'production', 'transfer') THEN
      RAISE EXCEPTION 'invalid entry classification: %', p_classification;
    END IF;
    IF v_kind = 'exit' AND v_class NOT IN (
      'sale', 'production', 'internal_consumption', 'transfer', 'loss'
    ) THEN
      RAISE EXCEPTION 'invalid exit classification: %', p_classification;
    END IF;
  END IF;

  SELECT p.company_id, NULLIF(btrim(p.unit), ''), p.current_quantity, p.average_cost, p.last_unit_value
  INTO v_company_id, v_product_unit, v_old_qty, v_old_avg, v_last_val
  FROM public.products p
  WHERE p.id = p_product_id
  FOR UPDATE;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'product not found: %', p_product_id;
  END IF;

  IF v_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.user_id = v_user_id AND uc.company_id = v_company_id
    ) THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;

  v_ref_type := CASE
    WHEN v_class = 'loss' THEN 'waste'
    WHEN v_kind = 'inventory' THEN 'inventory_count'
    ELSE 'manual'
  END;

  v_is_purchase_entry := v_kind = 'entry'
    AND v_class = 'purchase'
    AND p_unit_price_stock IS NOT NULL
    AND p_unit_price_stock > 0;

  v_base_avg := COALESCE(v_old_avg, v_last_val, 0);
  v_new_qty := v_old_qty + p_delta;

  IF v_is_purchase_entry THEN
    IF v_new_qty <= 0 THEN
      v_new_avg := v_old_avg;
    ELSIF v_old_qty <= 0 THEN
      v_new_avg := p_unit_price_stock;
    ELSE
      v_new_avg := (v_old_qty * v_base_avg + p_delta * p_unit_price_stock) / v_new_qty;
    END IF;
  ELSE
    v_new_avg := v_old_avg;
  END IF;

  v_mov_cost := CASE
    WHEN p_delta > 0 THEN p_unit_price_stock
    ELSE NULLIF(v_base_avg, 0)
  END;

  v_mov_type := CASE
    WHEN p_delta > 0 THEN 'in'
    WHEN v_ref_type = 'waste' THEN 'waste'
    ELSE 'out'
  END;

  v_metadata := jsonb_strip_nulls(
    jsonb_build_object(
      'quantity_unit', COALESCE(NULLIF(btrim(p_input_unit_code), ''), v_product_unit, 'un'),
      'input_quantity', p_input_quantity,
      'input_unit_code', NULLIF(btrim(p_input_unit_code), ''),
      'classification', NULLIF(v_class, ''),
      'movement_kind', v_kind,
      'registration_mode', 'single',
      'movement_at', p_movement_at,
      'unit_price_input', p_unit_price_stock,
      'expiry_date', p_expiry_date,
      'registered_by_user_id', v_user_id,
      'registered_by_name', v_user_name
    )
  );

  UPDATE public.products SET
    current_quantity = v_new_qty,
    last_unit_value = CASE
      WHEN v_is_purchase_entry THEN p_unit_price_stock
      ELSE last_unit_value
    END,
    average_cost = CASE
      WHEN v_is_purchase_entry THEN v_new_avg
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
    metadata_json,
    created_at
  )
  VALUES (
    p_product_id,
    v_company_id,
    ABS(p_delta),
    v_mov_type,
    v_ref_type,
    NULL,
    v_mov_cost,
    v_metadata,
    COALESCE(p_movement_at, NOW())
  )
  RETURNING id INTO v_movement_id;

  IF p_expiry_date IS NOT NULL AND p_delta > 0 THEN
    v_lot_entry := jsonb_build_object(
      'id', gen_random_uuid()::text,
      'quantity', ABS(p_delta),
      'expiry_date', to_char(p_expiry_date, 'YYYY-MM-DD'),
      'stock_movement_id', v_movement_id,
      'created_at', NOW()
    );
    UPDATE public.products SET
      stock_lots = COALESCE(stock_lots, '[]'::jsonb) || jsonb_build_array(v_lot_entry),
      updated_at = NOW()
    WHERE id = p_product_id;
  END IF;

  RETURN v_movement_id;
END;
$$;

COMMENT ON FUNCTION public.register_manual_stock_movement(
  UUID, TEXT, TEXT, DECIMAL, DECIMAL, TEXT, DECIMAL, TIMESTAMPTZ, DATE
) IS
  'Movimentação manual (modo única). Entrada com validade acrescenta lote em products.stock_lots.';

GRANT EXECUTE ON FUNCTION public.register_manual_stock_movement(
  UUID, TEXT, TEXT, DECIMAL, DECIMAL, TEXT, DECIMAL, TIMESTAMPTZ, DATE
) TO authenticated;

-- Preço/CMV da listagem vêm de products.last_unit_value / average_cost.
-- Cadastro via NF (nfe_product_create) gravava unit_cost na movimentação, mas
-- adjust_product_stock só atualizava o cadastro em expense_item / import_breakdown.

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
  v_is_valued_purchase BOOLEAN;
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

  v_is_valued_purchase := p_delta > 0
    AND p_unit_value IS NOT NULL
    AND p_unit_value > 0
    AND v_ref_type IN (
      'expense_item',
      'import_breakdown',
      'nfe_product_create'
    );

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

  IF v_is_valued_purchase THEN
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
      WHEN v_is_valued_purchase THEN p_unit_value
      ELSE last_unit_value
    END,
    last_unit_value_stock = CASE
      WHEN v_is_valued_purchase THEN p_unit_value
      ELSE last_unit_value_stock
    END,
    last_unit_value_unit_code = CASE
      WHEN v_is_valued_purchase THEN COALESCE(v_product_unit, last_unit_value_unit_code, 'un')
      ELSE last_unit_value_unit_code
    END,
    average_cost = CASE
      WHEN v_is_valued_purchase THEN v_new_avg
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
  'Ajusta saldo e CMV. Preço do cadastro atualiza em compra valorada (despesa, explosão de NF ou cadastro via NF).';

CREATE OR REPLACE FUNCTION public.create_product_with_stock_in(
  p_company_id UUID,
  p_product JSONB,
  p_quantity NUMERIC,
  p_unit_value NUMERIC DEFAULT NULL,
  p_reference_type TEXT DEFAULT 'nfe_product_create',
  p_reference_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product_id UUID;
  v_name TEXT;
  v_unit TEXT;
  v_qty NUMERIC;
  v_unit_value NUMERIC;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'create_product_with_stock_in: company_id obrigatório';
  END IF;

  v_qty := COALESCE(p_quantity, 0);
  IF v_qty <= 0 THEN
    RAISE EXCEPTION 'create_product_with_stock_in: quantidade de entrada deve ser > 0 (recebido %)', v_qty;
  END IF;

  v_name := NULLIF(btrim(COALESCE(p_product ->> 'name', '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'create_product_with_stock_in: name obrigatório';
  END IF;

  v_unit := COALESCE(NULLIF(btrim(COALESCE(p_product ->> 'unit', '')), ''), 'un');
  v_unit_value := CASE
    WHEN p_unit_value IS NOT NULL AND p_unit_value > 0 THEN p_unit_value
    ELSE NULL
  END;

  INSERT INTO public.products (
    company_id,
    name,
    unit,
    ncm,
    cfop,
    csosn,
    ean,
    min_quantity,
    current_quantity,
    canonical_name,
    is_active,
    stock_control_type,
    unit_conversions,
    last_unit_value,
    last_unit_value_unit_code,
    last_unit_value_stock,
    average_cost
  ) VALUES (
    p_company_id,
    left(v_name, 512),
    left(v_unit, 32),
    NULLIF(btrim(COALESCE(p_product ->> 'ncm', '')), ''),
    NULLIF(btrim(COALESCE(p_product ->> 'cfop', '')), ''),
    NULLIF(btrim(COALESCE(p_product ->> 'csosn', '')), ''),
    NULLIF(btrim(COALESCE(p_product ->> 'ean', '')), ''),
    COALESCE((p_product ->> 'min_quantity')::NUMERIC, 0),
    0,
    NULLIF(btrim(COALESCE(p_product ->> 'canonical_name', '')), ''),
    COALESCE((p_product ->> 'is_active')::BOOLEAN, true),
    COALESCE(NULLIF(btrim(COALESCE(p_product ->> 'stock_control_type', '')), ''), 'DIRECT'),
    CASE
      WHEN jsonb_typeof(p_product -> 'unit_conversions') = 'array'
        THEN p_product -> 'unit_conversions'
      ELSE '[]'::jsonb
    END,
    v_unit_value,
    CASE WHEN v_unit_value IS NOT NULL THEN left(v_unit, 32) ELSE NULL END,
    v_unit_value,
    v_unit_value
  )
  RETURNING id INTO v_product_id;

  PERFORM public.adjust_product_stock(
    v_product_id,
    v_qty,
    'in',
    COALESCE(NULLIF(btrim(p_reference_type), ''), 'nfe_product_create'),
    p_reference_id,
    v_unit_value
  );

  RETURN v_product_id;
END;
$$;

WITH last_in AS (
  SELECT DISTINCT ON (sm.product_id)
    sm.product_id,
    sm.unit_cost
  FROM public.stock_movements sm
  WHERE sm.type = 'in'
    AND sm.unit_cost IS NOT NULL
    AND sm.unit_cost > 0
    AND (sm.metadata_json->>'undone_at') IS NULL
  ORDER BY sm.product_id, sm.created_at DESC
)
UPDATE public.products p
SET
  last_unit_value = lei.unit_cost,
  last_unit_value_stock = COALESCE(NULLIF(p.last_unit_value_stock, 0), lei.unit_cost),
  last_unit_value_unit_code = COALESCE(NULLIF(btrim(p.last_unit_value_unit_code), ''), p.unit),
  average_cost = COALESCE(NULLIF(p.average_cost, 0), lei.unit_cost),
  updated_at = now()
FROM last_in lei
WHERE p.id = lei.product_id
  AND COALESCE(p.last_unit_value, 0) <= 0
  AND COALESCE(p.last_unit_value_stock, 0) <= 0
  AND COALESCE(p.average_cost, 0) <= 0;

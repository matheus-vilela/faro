-- Cria produto e movimentação de entrada na mesma transação.
-- Se a movimentação falhar, o produto também é revertido (rollback do TX).

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
    unit_conversions
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
    END
  )
  RETURNING id INTO v_product_id;

  PERFORM public.adjust_product_stock(
    v_product_id,
    v_qty,
    'in',
    COALESCE(NULLIF(btrim(p_reference_type), ''), 'nfe_product_create'),
    p_reference_id,
    p_unit_value
  );

  RETURN v_product_id;
END;
$$;

COMMENT ON FUNCTION public.create_product_with_stock_in(UUID, JSONB, NUMERIC, NUMERIC, TEXT, UUID) IS
  'Insere produto e aplica entrada de estoque na mesma transação. Falha de um reverte o outro.';

GRANT EXECUTE ON FUNCTION public.create_product_with_stock_in(UUID, JSONB, NUMERIC, NUMERIC, TEXT, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_product_with_stock_in(UUID, JSONB, NUMERIC, NUMERIC, TEXT, UUID)
  TO authenticated;

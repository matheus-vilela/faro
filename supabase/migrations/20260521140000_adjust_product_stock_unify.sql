-- Remove overload duplicada criada em 20260520120000 (5 args) que conflitava com a versão
-- de 6 args (p_unit_value DEFAULT NULL). Chamadas RPC com 5 parâmetros geravam:
-- "function public.adjust_product_stock(uuid, numeric, unknown, unknown, uuid) is not unique"

DROP FUNCTION IF EXISTS public.adjust_product_stock(UUID, DECIMAL, TEXT, TEXT, UUID);

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
BEGIN
  SELECT company_id INTO v_company_id
  FROM public.products
  WHERE id = p_product_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'product not found: %', p_product_id;
  END IF;

  UPDATE public.products SET
    current_quantity = current_quantity + p_delta,
    last_unit_value = CASE
      WHEN p_delta > 0 AND p_unit_value IS NOT NULL THEN p_unit_value
      ELSE last_unit_value
    END,
    updated_at = NOW()
  WHERE id = p_product_id;

  INSERT INTO public.stock_movements (
    product_id,
    company_id,
    quantity,
    type,
    reference_type,
    reference_id
  )
  VALUES (
    p_product_id,
    v_company_id,
    ABS(p_delta),
    CASE WHEN p_delta >= 0 THEN 'in' ELSE 'out' END,
    p_reference_type,
    p_reference_id
  );
END;
$$;

COMMENT ON FUNCTION public.adjust_product_stock(UUID, DECIMAL, TEXT, TEXT, UUID, DECIMAL) IS
  'Ajusta saldo do produto e registra movimentação com company_id denormalizado.';

GRANT EXECUTE ON FUNCTION public.adjust_product_stock(UUID, DECIMAL, TEXT, TEXT, UUID, DECIMAL)
  TO anon, authenticated;

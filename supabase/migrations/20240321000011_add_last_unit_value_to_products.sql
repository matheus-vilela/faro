-- Último valor pago por unidade do produto
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS last_unit_value DECIMAL(12, 2);

-- Estender adjust_product_stock para aceitar unit_value e atualizar last_unit_value
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
BEGIN
  UPDATE products SET
    current_quantity = GREATEST(0, current_quantity + p_delta),
    last_unit_value = CASE
      WHEN p_delta > 0 AND p_unit_value IS NOT NULL THEN p_unit_value
      ELSE last_unit_value
    END,
    updated_at = NOW()
  WHERE id = p_product_id;

  INSERT INTO stock_movements (product_id, quantity, type, reference_type, reference_id)
  VALUES (p_product_id, ABS(p_delta), CASE WHEN p_delta >= 0 THEN 'in' ELSE 'out' END, p_reference_type, p_reference_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_product_stock(UUID, DECIMAL, TEXT, TEXT, UUID, DECIMAL) TO anon, authenticated;

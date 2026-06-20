-- Converte quantidade vendida (ex.: EPOC em UN) para a unidade de estoque do produto.

CREATE OR REPLACE FUNCTION public.product_sale_qty_in_stock_unit(
  p_product_id uuid,
  p_sale_quantity numeric,
  p_sale_unit_code text DEFAULT 'un'
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN public.recipe_ingredient_qty_in_stock_unit(
    p_product_id,
    p_sale_quantity,
    p_sale_quantity,
    coalesce(nullif(btrim(p_sale_unit_code), ''), 'un')
  );
END;
$$;

COMMENT ON FUNCTION public.product_sale_qty_in_stock_unit(uuid, numeric, text) IS
  'Quantidade na unidade de estoque (products.unit) a partir da venda em outra unidade (ex.: UN no CSV EPOC), via product_unit_conversions ou system_unit_ratio.';

GRANT EXECUTE ON FUNCTION public.product_sale_qty_in_stock_unit(uuid, numeric, text) TO authenticated, service_role;

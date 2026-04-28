-- Receita por venda não deve falhar por estoque insuficiente.
-- Também permite saldo negativo em products.current_quantity.

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
    current_quantity = current_quantity + p_delta,
    last_unit_value = CASE
      WHEN p_delta > 0 AND p_unit_value IS NOT NULL THEN p_unit_value
      ELSE last_unit_value
    END,
    updated_at = NOW()
  WHERE id = p_product_id;

  INSERT INTO stock_movements (product_id, quantity, type, reference_type, reference_id)
  VALUES (
    p_product_id,
    ABS(p_delta),
    CASE WHEN p_delta >= 0 THEN 'in' ELSE 'out' END,
    p_reference_type,
    p_reference_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.adjust_product_stock(UUID, DECIMAL, TEXT, TEXT, UUID, DECIMAL) TO anon, authenticated;

DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('public.create_revenue_entry(jsonb)'::regprocedure)
  INTO v_def;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'Função public.create_revenue_entry(jsonb) não encontrada';
  END IF;

  -- Produto: remove bloqueio por estoque insuficiente.
  v_def := regexp_replace(
    v_def,
    E'\\n\\s*IF v_csv_import_job_id IS NULL AND v_stock < v_quantity THEN\\n\\s*RAISE EXCEPTION ''Estoque insuficiente para a quantidade informada'';\\n\\s*END IF;\\n',
    E'\n',
    'g'
  );
  v_def := regexp_replace(
    v_def,
    E'\\n\\s*IF v_stock < v_quantity THEN\\n\\s*RAISE EXCEPTION ''Estoque insuficiente para a quantidade informada'';\\n\\s*END IF;\\n',
    E'\n',
    'g'
  );

  -- Receita (ficha): remove bloqueio por estoque insuficiente de ingredientes.
  v_def := regexp_replace(
    v_def,
    E'\\n\\s*IF v_stock < v_need_r THEN\\n\\s*RAISE EXCEPTION ''Estoque insuficiente para produzir a receita'';\\n\\s*END IF;\\n',
    E'\n',
    'g'
  );

  EXECUTE v_def;
END;
$$;

COMMENT ON FUNCTION public.create_revenue_entry(jsonb) IS
  'Insere receita e baixa estoque mesmo com saldo insuficiente, permitindo estoque negativo em vendas.';

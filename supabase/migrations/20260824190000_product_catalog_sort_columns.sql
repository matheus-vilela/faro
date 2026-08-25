-- Colunas geradas para ordenar preço/valor do catálogo no banco (paginação).

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS catalog_unit_cost NUMERIC
  GENERATED ALWAYS AS (
    CASE
      WHEN average_cost IS NOT NULL AND average_cost > 0 THEN average_cost
      WHEN last_unit_value_stock IS NOT NULL AND last_unit_value_stock > 0
        THEN last_unit_value_stock
      WHEN last_unit_value IS NOT NULL AND last_unit_value > 0 THEN last_unit_value
      ELSE NULL
    END
  ) STORED;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS catalog_stock_value NUMERIC
  GENERATED ALWAYS AS (
    current_quantity * (
      CASE
        WHEN average_cost IS NOT NULL AND average_cost > 0 THEN average_cost
        WHEN last_unit_value_stock IS NOT NULL AND last_unit_value_stock > 0
          THEN last_unit_value_stock
        WHEN last_unit_value IS NOT NULL AND last_unit_value > 0 THEN last_unit_value
        ELSE NULL
      END
    )
  ) STORED;

COMMENT ON COLUMN public.products.catalog_unit_cost IS
  'Preço unitário para ordenação/listagem: CMV, senão último preço em estoque, senão último preço.';

COMMENT ON COLUMN public.products.catalog_stock_value IS
  'Valor em estoque (quantidade × preço unitário de catálogo) para ordenação.';

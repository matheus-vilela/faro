-- Menor e maior preço unitário (vUnCom) observados por cProd do fornecedor.

ALTER TABLE public.unified_supplier_products
  ADD COLUMN IF NOT EXISTS min_price NUMERIC(18, 6),
  ADD COLUMN IF NOT EXISTS max_price NUMERIC(18, 6);

COMMENT ON COLUMN public.unified_supplier_products.min_price IS
  'Menor preço unitário efetivo já visto para este cProd neste fornecedor.';
COMMENT ON COLUMN public.unified_supplier_products.max_price IS
  'Maior preço unitário efetivo já visto para este cProd neste fornecedor.';

-- Backfill a partir do último valor unitário já gravado (instalações antigas).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'unified_supplier_products'
      AND column_name = 'unit_value_last'
  ) THEN
    UPDATE public.unified_supplier_products
    SET
      min_price = unit_value_last,
      max_price = unit_value_last
    WHERE
      min_price IS NULL
      AND max_price IS NULL
      AND unit_value_last IS NOT NULL
      AND unit_value_last > 0;
  END IF;
END $$;

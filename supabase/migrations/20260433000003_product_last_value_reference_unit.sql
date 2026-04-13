ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS last_unit_value_unit_code TEXT;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS last_unit_value_stock DECIMAL(14, 8);

UPDATE public.products
SET
  last_unit_value_unit_code = COALESCE(last_unit_value_unit_code, unit),
  last_unit_value_stock = COALESCE(last_unit_value_stock, last_unit_value);

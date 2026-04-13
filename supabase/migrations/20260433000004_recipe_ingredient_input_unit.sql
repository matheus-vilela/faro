ALTER TABLE public.recipe_ingredients
  ADD COLUMN IF NOT EXISTS input_quantity DECIMAL(12, 4);

ALTER TABLE public.recipe_ingredients
  ADD COLUMN IF NOT EXISTS input_unit_code TEXT;

UPDATE public.recipe_ingredients ri
SET
  input_quantity = COALESCE(ri.input_quantity, ri.quantity),
  input_unit_code = COALESCE(ri.input_unit_code, p.unit)
FROM public.products p
WHERE p.id = ri.product_id;

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS input_quantity DECIMAL(12, 4);

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS input_unit_code TEXT;

UPDATE public.purchase_order_items i
SET
  input_quantity = COALESCE(i.input_quantity, i.quantity),
  input_unit_code = COALESCE(i.input_unit_code, p.unit)
FROM public.products p
WHERE p.id = i.product_id;

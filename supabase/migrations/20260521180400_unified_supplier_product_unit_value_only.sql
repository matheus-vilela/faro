-- Catálogo global: só preço unitário efetivo; remove quantidade e total da linha.

ALTER TABLE public.unified_supplier_products
  DROP COLUMN IF EXISTS quantity_last,
  DROP COLUMN IF EXISTS line_total_last;

COMMENT ON COLUMN public.unified_supplier_products.unit_value_last IS
  'Último preço unitário efetivo (uCom): líquido da linha NF-e + rateio proporcional de frete/desconto/outros do ICMSTot.';

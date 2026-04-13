-- Filtros e alertas de estoque na listagem de produtos (gerado a partir de quantidades).

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock_is_zero boolean
  GENERATED ALWAYS AS (current_quantity <= 0) STORED;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock_below_min_positive boolean
  GENERATED ALWAYS AS (
    min_quantity > 0 AND current_quantity > 0 AND current_quantity <= min_quantity
  ) STORED;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock_below_min_inclusive boolean
  GENERATED ALWAYS AS (
    min_quantity > 0 AND current_quantity <= min_quantity
  ) STORED;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS stock_has_alert boolean
  GENERATED ALWAYS AS (
    (current_quantity <= 0) OR (min_quantity > 0 AND current_quantity <= min_quantity)
  ) STORED;

COMMENT ON COLUMN public.products.stock_is_zero IS
  'Estoque zerado ou negativo (alerta).';
COMMENT ON COLUMN public.products.stock_below_min_positive IS
  'Estoque > 0 e quantidade na ou abaixo do mínimo cadastrado (alerta).';
COMMENT ON COLUMN public.products.stock_below_min_inclusive IS
  'Mínimo > 0 e quantidade na ou abaixo do mínimo (inclui zerado).';
COMMENT ON COLUMN public.products.stock_has_alert IS
  'Qualquer situação de alerta: zerado ou abaixo do mínimo quando há mínimo.';

CREATE INDEX IF NOT EXISTS idx_products_company_stock_alert
  ON public.products (company_id, stock_has_alert)
  WHERE stock_has_alert = true;

CREATE INDEX IF NOT EXISTS idx_products_company_updated_at
  ON public.products (company_id, updated_at DESC);

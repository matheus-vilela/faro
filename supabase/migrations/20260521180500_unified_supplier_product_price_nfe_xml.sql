-- XML da NF-e em que foi observado o menor e o maior preço unitário efetivo (por unidade).

ALTER TABLE public.unified_supplier_product_company_prices
  ADD COLUMN IF NOT EXISTS min_price_chave_nfe TEXT,
  ADD COLUMN IF NOT EXISTS max_price_chave_nfe TEXT,
  ADD COLUMN IF NOT EXISTS min_price_nfe_xml TEXT,
  ADD COLUMN IF NOT EXISTS max_price_nfe_xml TEXT;

COMMENT ON COLUMN public.unified_supplier_product_company_prices.min_price_chave_nfe IS
  'Chave NF-e (44 dígitos) da nota em que foi registrado o menor preço efetivo.';
COMMENT ON COLUMN public.unified_supplier_product_company_prices.max_price_chave_nfe IS
  'Chave NF-e da nota em que foi registrado o maior preço efetivo.';
COMMENT ON COLUMN public.unified_supplier_product_company_prices.min_price_nfe_xml IS
  'XML completo da NF-e vinculado ao menor preço unitário efetivo observado.';
COMMENT ON COLUMN public.unified_supplier_product_company_prices.max_price_nfe_xml IS
  'XML completo da NF-e vinculado ao maior preço unitário efetivo observado.';

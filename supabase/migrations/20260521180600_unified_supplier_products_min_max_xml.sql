-- Preço mínimo/máximo global no produto (ecossistema) + XML da NF-e de cada extremo.

ALTER TABLE public.unified_supplier_products
  ADD COLUMN IF NOT EXISTS min_price NUMERIC(18, 6),
  ADD COLUMN IF NOT EXISTS max_price NUMERIC(18, 6),
  ADD COLUMN IF NOT EXISTS min_price_chave_nfe TEXT,
  ADD COLUMN IF NOT EXISTS max_price_chave_nfe TEXT,
  ADD COLUMN IF NOT EXISTS min_price_nfe_xml TEXT,
  ADD COLUMN IF NOT EXISTS max_price_nfe_xml TEXT;

COMMENT ON COLUMN public.unified_supplier_products.min_price IS
  'Menor preço unitário efetivo (uCom) já observado para este cProd neste fornecedor.';
COMMENT ON COLUMN public.unified_supplier_products.max_price IS
  'Maior preço unitário efetivo (uCom) já observado para este cProd neste fornecedor.';
COMMENT ON COLUMN public.unified_supplier_products.min_price_chave_nfe IS
  'Chave NF-e da nota em que foi registrado o menor preço.';
COMMENT ON COLUMN public.unified_supplier_products.max_price_chave_nfe IS
  'Chave NF-e da nota em que foi registrado o maior preço.';
COMMENT ON COLUMN public.unified_supplier_products.min_price_nfe_xml IS
  'XML completo da NF-e do menor preço unitário efetivo.';
COMMENT ON COLUMN public.unified_supplier_products.max_price_nfe_xml IS
  'XML completo da NF-e do maior preço unitário efetivo.';

ALTER TABLE public.unified_supplier_products
  DROP COLUMN IF EXISTS unit_value_last;

-- Copia faixa da tabela por empresa, se existir (legado).
UPDATE public.unified_supplier_products p
SET
  min_price = sub.min_price,
  max_price = sub.max_price,
  min_price_chave_nfe = sub.min_price_chave_nfe,
  max_price_chave_nfe = sub.max_price_chave_nfe,
  min_price_nfe_xml = sub.min_price_nfe_xml,
  max_price_nfe_xml = sub.max_price_nfe_xml
FROM (
  SELECT DISTINCT ON (unified_supplier_product_id)
    unified_supplier_product_id,
    min_price,
    max_price,
    min_price_chave_nfe,
    max_price_chave_nfe,
    min_price_nfe_xml,
    max_price_nfe_xml
  FROM public.unified_supplier_product_company_prices
  ORDER BY unified_supplier_product_id, last_seen_at DESC NULLS LAST
) sub
WHERE p.id = sub.unified_supplier_product_id
  AND p.min_price IS NULL
  AND p.max_price IS NULL;


DROP TABLE IF EXISTS public.unified_supplier_product_company_prices CASCADE;
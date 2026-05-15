-- EAN/GTIN no cadastro de produto (vínculo na interpretação NF-e em staging).
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS ean TEXT;

COMMENT ON COLUMN public.products.ean IS
  'Código de barras EAN/GTIN (apenas dígitos ou texto normalizado na aplicação).';

CREATE INDEX IF NOT EXISTS idx_products_company_ean
  ON public.products (company_id, ean)
  WHERE ean IS NOT NULL AND btrim(ean) <> '';

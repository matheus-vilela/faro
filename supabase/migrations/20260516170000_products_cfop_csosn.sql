-- CFOP e CSOSN (ou CST em regime normal) obrigatórios em novos cadastros via app.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cfop TEXT,
  ADD COLUMN IF NOT EXISTS csosn TEXT;

COMMENT ON COLUMN public.products.cfop IS
  'CFOP da operação (4 dígitos), quando informado no XML da NF-e.';
COMMENT ON COLUMN public.products.csosn IS
  'CSOSN (Simples) ou CST (regime normal), só dígitos; opcional, preenchido quando consta no XML.';

CREATE INDEX IF NOT EXISTS idx_products_company_ncm_cfop
  ON public.products (company_id, ncm, cfop)
  WHERE ncm IS NOT NULL AND cfop IS NOT NULL;

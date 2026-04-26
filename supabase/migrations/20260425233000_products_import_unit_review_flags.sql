-- Flags para rastrear unidade vinda da importação quando não casar com unidade do sistema.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS import_unit_raw TEXT,
  ADD COLUMN IF NOT EXISTS import_unit_needs_review BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.products.import_unit_raw IS
  'Unidade original recebida do XML/nota quando não houve mapeamento confiável para o catálogo de unidades do sistema.';

COMMENT ON COLUMN public.products.import_unit_needs_review IS
  'True quando a unidade do produto foi criada com valor legado/desconhecido e precisa de revisão pelo usuário.';

CREATE INDEX IF NOT EXISTS idx_products_import_unit_review
  ON public.products(company_id, import_unit_needs_review)
  WHERE import_unit_needs_review = true;

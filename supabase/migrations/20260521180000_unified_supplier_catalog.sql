-- Catálogo global de fornecedores e produtos (NF-e), independente de empresa.
-- Alimentado pelo XML em focus-get-sync-nfe (focus_get_sync_nfe_staging.xml_content).

CREATE TABLE IF NOT EXISTS public.unified_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_document TEXT NOT NULL,
  name TEXT NOT NULL,
  fantasy_name TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sighting_count INT NOT NULL DEFAULT 1 CHECK (sighting_count >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unified_suppliers_tax_document_len CHECK (
    char_length(tax_document) = 11 OR char_length(tax_document) = 14
  ),
  CONSTRAINT unified_suppliers_tax_document_unique UNIQUE (tax_document)
);

COMMENT ON TABLE public.unified_suppliers IS
  'Fornecedores únicos no ecossistema Faro (CPF/CNPJ normalizado), para análises internas.';
COMMENT ON COLUMN public.unified_suppliers.tax_document IS
  'CPF (11) ou CNPJ (14) só dígitos, CNPJ com zeros à esquerda.';

CREATE TABLE IF NOT EXISTS public.unified_supplier_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unified_supplier_id UUID NOT NULL REFERENCES public.unified_suppliers (id) ON DELETE CASCADE,
  c_prod TEXT NOT NULL,
  product_name TEXT NOT NULL,
  ean TEXT,
  ncm TEXT,
  cfop TEXT,
  csosn TEXT,
  unit_commercial TEXT,
  unit_tax TEXT,
  min_price NUMERIC(18, 6),
  max_price NUMERIC(18, 6),
  min_price_chave_nfe TEXT,
  max_price_chave_nfe TEXT,
  min_price_nfe_xml TEXT,
  max_price_nfe_xml TEXT,
  xml_prod JSONB NOT NULL DEFAULT '{}'::jsonb,
  xml_det JSONB NOT NULL DEFAULT '{}'::jsonb,
  chave_nfe_last TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sighting_count INT NOT NULL DEFAULT 1 CHECK (sighting_count >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unified_supplier_products_c_prod_nonempty CHECK (char_length(btrim(c_prod)) > 0),
  CONSTRAINT unified_supplier_products_supplier_cprod_unique UNIQUE (unified_supplier_id, c_prod)
);

COMMENT ON TABLE public.unified_supplier_products IS
  'Produtos do fornecedor identificados por cProd (tag prod da NF-e); xml_prod/xml_det guardam o bloco XML parseado.';
COMMENT ON COLUMN public.unified_supplier_products.min_price IS
  'Menor preço unitário efetivo (uCom) observado para este cProd.';
COMMENT ON COLUMN public.unified_supplier_products.max_price IS
  'Maior preço unitário efetivo (uCom) observado para este cProd.';
COMMENT ON COLUMN public.unified_supplier_products.min_price_chave_nfe IS
  'Chave NF-e da nota em que foi registrado o menor preço.';
COMMENT ON COLUMN public.unified_supplier_products.max_price_chave_nfe IS
  'Chave NF-e da nota em que foi registrado o maior preço.';
COMMENT ON COLUMN public.unified_supplier_products.min_price_nfe_xml IS
  'XML completo da NF-e do menor preço unitário efetivo.';
COMMENT ON COLUMN public.unified_supplier_products.max_price_nfe_xml IS
  'XML completo da NF-e do maior preço unitário efetivo.';
COMMENT ON COLUMN public.unified_supplier_products.xml_prod IS
  'Objeto JSON do elemento <prod> da linha <det> (todos os campos presentes no XML).';
COMMENT ON COLUMN public.unified_supplier_products.xml_det IS
  'Snapshot JSON da linha <det> (prod, imposto resumido, nItem quando existir).';

CREATE TABLE IF NOT EXISTS public.unified_supplier_product_description_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unified_supplier_product_id UUID NOT NULL
    REFERENCES public.unified_supplier_products (id) ON DELETE CASCADE,
  previous_product_name TEXT,
  new_product_name TEXT NOT NULL,
  previous_ean TEXT,
  new_ean TEXT,
  chave_nfe TEXT,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.unified_supplier_product_description_history IS
  'Histórico quando o mesmo cProd reaparece com EAN diferente (atualiza nome/descrição no produto principal).';

CREATE INDEX IF NOT EXISTS idx_unified_suppliers_last_seen
  ON public.unified_suppliers (last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_unified_suppliers_name_lower
  ON public.unified_suppliers (lower(name));

CREATE INDEX IF NOT EXISTS idx_unified_supplier_products_supplier
  ON public.unified_supplier_products (unified_supplier_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_unified_supplier_products_cprod
  ON public.unified_supplier_products (c_prod);

CREATE INDEX IF NOT EXISTS idx_unified_supplier_product_desc_hist_product
  ON public.unified_supplier_product_description_history (
    unified_supplier_product_id,
    observed_at DESC
  );

DROP TRIGGER IF EXISTS unified_suppliers_set_updated_at ON public.unified_suppliers;
CREATE TRIGGER unified_suppliers_set_updated_at
  BEFORE UPDATE ON public.unified_suppliers
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

DROP TRIGGER IF EXISTS unified_supplier_products_set_updated_at ON public.unified_supplier_products;
CREATE TRIGGER unified_supplier_products_set_updated_at
  BEFORE UPDATE ON public.unified_supplier_products
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.unified_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unified_supplier_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unified_supplier_product_description_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read unified suppliers" ON public.unified_suppliers;
CREATE POLICY "Authenticated read unified suppliers"
  ON public.unified_suppliers FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated read unified supplier products" ON public.unified_supplier_products;
CREATE POLICY "Authenticated read unified supplier products"
  ON public.unified_supplier_products FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated read unified supplier product history" ON public.unified_supplier_product_description_history;
CREATE POLICY "Authenticated read unified supplier product history"
  ON public.unified_supplier_product_description_history FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.unified_suppliers TO authenticated;
GRANT SELECT ON public.unified_supplier_products TO authenticated;
GRANT SELECT ON public.unified_supplier_product_description_history TO authenticated;

GRANT ALL ON public.unified_suppliers TO service_role;
GRANT ALL ON public.unified_supplier_products TO service_role;
GRANT ALL ON public.unified_supplier_product_description_history TO service_role;

-- Vínculo determinístico produto da empresa ↔ cProd do fornecedor (NF-e).
-- Usado na interpretação staging para localizar produto sem match por IA.

CREATE TABLE IF NOT EXISTS public.product_supplier_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies (id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES public.suppliers (id) ON DELETE CASCADE,
  c_prod TEXT NOT NULL,
  product_id UUID NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT product_supplier_codes_c_prod_nonempty
    CHECK (char_length(btrim(c_prod)) > 0),
  CONSTRAINT product_supplier_codes_unique
    UNIQUE (company_id, supplier_id, c_prod)
);

COMMENT ON TABLE public.product_supplier_codes IS
  'Código do produto no fornecedor (cProd da NF-e) vinculado ao produto da empresa.';
COMMENT ON COLUMN public.product_supplier_codes.c_prod IS
  'cProd do XML da NF-e (trim); único por empresa + fornecedor.';

CREATE INDEX IF NOT EXISTS idx_product_supplier_codes_product
  ON public.product_supplier_codes (product_id);

CREATE INDEX IF NOT EXISTS idx_product_supplier_codes_supplier
  ON public.product_supplier_codes (company_id, supplier_id);

DROP TRIGGER IF EXISTS product_supplier_codes_set_updated_at
  ON public.product_supplier_codes;
CREATE TRIGGER product_supplier_codes_set_updated_at
  BEFORE UPDATE ON public.product_supplier_codes
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.product_supplier_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage company product supplier codes"
  ON public.product_supplier_codes;
CREATE POLICY "Users can manage company product supplier codes"
  ON public.product_supplier_codes FOR ALL
  USING (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT company_id FROM public.user_companies WHERE user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_supplier_codes TO authenticated;
GRANT ALL ON public.product_supplier_codes TO service_role;

-- Merge de produtos: reatribui cProd do perdedor; em conflito mantém o do vencedor.
CREATE OR REPLACE FUNCTION public.reassign_product_supplier_codes_on_product_merge(
  p_winner_id UUID,
  p_loser_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.product_supplier_codes l
  WHERE l.product_id = p_loser_id
    AND EXISTS (
      SELECT 1
      FROM public.product_supplier_codes w
      WHERE w.company_id = l.company_id
        AND w.supplier_id = l.supplier_id
        AND w.c_prod = l.c_prod
        AND w.product_id = p_winner_id
    );

  UPDATE public.product_supplier_codes
  SET product_id = p_winner_id, updated_at = NOW()
  WHERE product_id = p_loser_id;
END;
$$;

COMMENT ON FUNCTION public.reassign_product_supplier_codes_on_product_merge(UUID, UUID) IS
  'Reatribui product_supplier_codes do produto perdedor para o vencedor no merge.';

GRANT EXECUTE ON FUNCTION public.reassign_product_supplier_codes_on_product_merge(UUID, UUID)
  TO service_role;

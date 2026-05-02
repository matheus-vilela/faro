-- Embeddings do nome do produto para RAG / similaridade semântica no match de importação NF-e.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS name_embedding extensions.vector(1536);

COMMENT ON COLUMN public.products.name_embedding IS
  'Embedding OpenAI text-embedding-3-small (1536 dims) do nome; usado em match_products_by_name_embedding.';

CREATE INDEX IF NOT EXISTS products_name_embedding_hnsw_idx
  ON public.products
  USING hnsw (name_embedding extensions.vector_cosine_ops)
  WHERE name_embedding IS NOT NULL;

CREATE OR REPLACE FUNCTION public.products_set_name_embedding(
  p_product_id uuid,
  p_company_id uuid,
  p_embedding_text text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    IF auth.uid() IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
    ) THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;

  UPDATE public.products p
  SET
    name_embedding = (trim(both from p_embedding_text))::extensions.vector(1536),
    updated_at = now()
  WHERE p.id = p_product_id
    AND p.company_id = p_company_id;
END;
$$;

REVOKE ALL ON FUNCTION public.products_set_name_embedding(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.products_set_name_embedding(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.products_set_name_embedding(uuid, uuid, text) TO service_role;

-- p_query_embedding: string "[0.012,...]" com 1536 floats (text-embedding-3-small).
CREATE OR REPLACE FUNCTION public.match_products_by_name_embedding(
  p_company_id uuid,
  p_query_embedding text,
  p_match_count int DEFAULT 20
)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  product_unit text,
  product_barcode text,
  product_ncm text,
  distance double precision
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    IF auth.uid() IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
    ) THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    COALESCE(p.unit, 'un'),
    p.barcode,
    p.ncm,
    (p.name_embedding <=> (trim(both from p_query_embedding))::extensions.vector(1536))::double precision
  FROM public.products p
  WHERE p.company_id = p_company_id
    AND p.is_active IS NOT FALSE
    AND p.name_embedding IS NOT NULL
  ORDER BY p.name_embedding <=> (trim(both from p_query_embedding))::extensions.vector(1536)
  LIMIT LEAST(GREATEST(COALESCE(p_match_count, 20), 1), 100);
END;
$$;

REVOKE ALL ON FUNCTION public.match_products_by_name_embedding(uuid, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_products_by_name_embedding(uuid, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_products_by_name_embedding(uuid, text, int) TO service_role;

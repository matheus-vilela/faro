-- list_company_ncms / list_company_ncm_products nasceram depois do
-- patch de admin Faro e ainda recusavam quem não está em user_companies.

CREATE OR REPLACE FUNCTION public.list_company_ncms(p_company_id UUID)
RETURNS TABLE (
  ncm TEXT,
  product_count BIGINT,
  expense_item_count BIGINT,
  sample_product_names TEXT[],
  product_category_id UUID,
  dre_category_id UUID
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.user_has_company_access(auth.uid(), p_company_id) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  RETURN QUERY
  WITH observed AS (
    SELECT
      public.normalize_ncm_8(p.ncm) AS ncm,
      p.name AS sample_name,
      1 AS product_hit,
      0 AS item_hit
    FROM public.products p
    WHERE p.company_id = p_company_id
      AND public.normalize_ncm_8(p.ncm) IS NOT NULL
    UNION ALL
    SELECT
      public.normalize_ncm_8(ei.ncm),
      ei.product_name,
      0,
      1
    FROM public.expense_items ei
    WHERE ei.company_id = p_company_id
      AND public.normalize_ncm_8(ei.ncm) IS NOT NULL
    UNION ALL
    SELECT
      r.ncm,
      NULL,
      0,
      0
    FROM public.company_ncm_category_rules r
    WHERE r.company_id = p_company_id
  ),
  agg AS (
    SELECT
      o.ncm,
      SUM(o.product_hit)::BIGINT AS product_count,
      SUM(o.item_hit)::BIGINT AS expense_item_count,
      COALESCE(
        (
          array_agg(DISTINCT NULLIF(btrim(o.sample_name), '') ORDER BY NULLIF(btrim(o.sample_name), ''))
          FILTER (WHERE NULLIF(btrim(o.sample_name), '') IS NOT NULL)
        )[1:3],
        ARRAY[]::TEXT[]
      ) AS sample_product_names
    FROM observed o
    WHERE o.ncm IS NOT NULL
    GROUP BY o.ncm
  )
  SELECT
    a.ncm,
    a.product_count,
    a.expense_item_count,
    a.sample_product_names,
    r.product_category_id,
    pc.default_dre_category_id
  FROM agg a
  LEFT JOIN public.company_ncm_category_rules r
    ON r.company_id = p_company_id AND r.ncm = a.ncm
  LEFT JOIN public.company_product_categories pc
    ON pc.id = r.product_category_id
  ORDER BY (r.product_category_id IS NULL) DESC, a.ncm;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_company_ncm_products(
  p_company_id UUID,
  p_ncm TEXT
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  unit TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ncm TEXT;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.user_has_company_access(auth.uid(), p_company_id) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  v_ncm := public.normalize_ncm_8(p_ncm);
  IF v_ncm IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT p.id, p.name, p.unit
  FROM public.products p
  WHERE p.company_id = p_company_id
    AND public.normalize_ncm_8(p.ncm) = v_ncm
  ORDER BY p.name
  LIMIT 200;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_company_ncms(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_company_ncm_products(UUID, TEXT) TO authenticated, service_role;

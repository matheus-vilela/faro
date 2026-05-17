-- Lista completa de fichas sem insumos (sem LIMIT 40).

CREATE OR REPLACE FUNCTION public.dashboard_import_review_epoc_recipes_no_ingredients_list(
  p_company_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
  ) THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH reviewed AS (
    SELECT pir.product_id
    FROM public.product_import_dashboard_review pir
    WHERE pir.company_id = p_company_id
      AND pir.review_bucket = 'RECIPE_NO_INGREDIENTS'
      AND pir.resolution <> 'OPEN'
  ),
  cand AS (
    SELECT
      r.id AS recipe_id,
      p.id AS product_id,
      coalesce(nullif(trim(r.name), ''), trim(p.name)) AS name,
      p.unit,
      EXISTS (
        SELECT 1 FROM public.revenue_entries re
        WHERE re.company_id = p_company_id
          AND re.product_id = p.id
          AND re.integration_csv_import_job_id IS NOT NULL
      ) AS priority_epoc
    FROM public.recipes r
    JOIN public.products p
      ON p.id = r.output_product_id AND p.company_id = r.company_id
    WHERE r.company_id = p_company_id
      AND (r.active IS DISTINCT FROM false)
      AND (p.is_active IS DISTINCT FROM false)
      AND NOT EXISTS (
        SELECT 1 FROM public.recipe_ingredients ri
        WHERE ri.recipe_id = r.id
      )
      AND NOT EXISTS (SELECT 1 FROM reviewed rv WHERE rv.product_id = p.id)
  )
  SELECT coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'recipe_id', x.recipe_id,
          'product_id', x.product_id,
          'name', x.name,
          'unit', x.unit,
          'priority_epoc', x.priority_epoc
        )
        ORDER BY x.priority_epoc DESC NULLS LAST, x.name ASC
      )
      FROM (
        SELECT * FROM cand
        ORDER BY priority_epoc DESC NULLS LAST, name ASC
      ) x
    ),
    '[]'::jsonb
  )
  INTO v_out;

  RETURN coalesce(v_out, '[]'::jsonb);
END;
$$;

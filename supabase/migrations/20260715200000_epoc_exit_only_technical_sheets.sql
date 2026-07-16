-- Fichas pendentes no dashboard: receitas sem insumos OU produtos só com saída (sem entrada).
-- Substitui a classificação prévia por IA no import EPOC.

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

  WITH reviewed_recipe AS (
    SELECT pir.product_id
    FROM public.product_import_dashboard_review pir
    WHERE pir.company_id = p_company_id
      AND pir.review_bucket = 'RECIPE_NO_INGREDIENTS'
      AND pir.resolution <> 'OPEN'
  ),
  reviewed_exit AS (
    SELECT pir.product_id
    FROM public.product_import_dashboard_review pir
    WHERE pir.company_id = p_company_id
      AND pir.review_bucket = 'EXIT_NO_ENTRY'
      AND pir.resolution <> 'OPEN'
  ),
  recipes_no_ing AS (
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
      AND NOT EXISTS (SELECT 1 FROM reviewed_recipe rv WHERE rv.product_id = p.id)
  ),
  exit_only_no_recipe AS (
    SELECT
      NULL::uuid AS recipe_id,
      p.id AS product_id,
      trim(p.name) AS name,
      p.unit,
      EXISTS (
        SELECT 1 FROM public.revenue_entries re
        WHERE re.company_id = p_company_id
          AND re.product_id = p.id
          AND re.integration_csv_import_job_id IS NOT NULL
      ) AS priority_epoc
    FROM public.products p
    WHERE p.company_id = p_company_id
      AND (p.is_active IS DISTINCT FROM false)
      AND EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.product_id = p.id AND sm.type = 'out'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.product_id = p.id AND sm.type = 'in'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.recipes r
        WHERE r.company_id = p_company_id
          AND r.output_product_id = p.id
          AND (r.active IS DISTINCT FROM false)
      )
      AND NOT EXISTS (SELECT 1 FROM reviewed_exit rv WHERE rv.product_id = p.id)
  ),
  cand AS (
    SELECT * FROM recipes_no_ing
    UNION ALL
    SELECT * FROM exit_only_no_recipe
  )
  SELECT coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'recipe_id', x.recipe_id,
          'product_id', x.product_id,
          'name', x.name,
          'unit', x.unit,
          'priority_epoc', x.priority_epoc,
          'needs_recipe', (x.recipe_id IS NULL)
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

COMMENT ON FUNCTION public.dashboard_import_review_epoc_recipes_no_ingredients_list(UUID) IS
  'Dashboard: fichas sem insumos ou produtos só com saída (sem entrada), pendentes de montagem ou confirmação.';

-- Alinha elegibilidade de criação manual de ficha com a mesma regra de movimentação.
CREATE OR REPLACE FUNCTION public.dashboard_import_review_confirm_outbound_as_recipe(
  p_company_id UUID,
  p_product_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok BOOLEAN;
  v_recipe_id UUID;
  v_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT p.name
  INTO v_name
  FROM public.products p
  WHERE p.id = p_product_id AND p.company_id = p_company_id
  FOR UPDATE;

  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'product_not_found');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.stock_movements sm
    WHERE sm.product_id = p_product_id AND sm.type = 'out'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_movements sm
    WHERE sm.product_id = p_product_id AND sm.type = 'in'
  )
  INTO v_ok;

  IF v_ok IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'eligibility_failed');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.recipes r
    WHERE r.company_id = p_company_id AND r.output_product_id = p_product_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recipe_already_exists');
  END IF;

  INSERT INTO public.recipes (
    company_id,
    name,
    output_product_id,
    batch_yield,
    active,
    recipe_type
  )
  VALUES (
    p_company_id,
    left(trim(v_name) || ' — ficha técnica', 500),
    p_product_id,
    1,
    true,
    'PREP'
  )
  RETURNING id INTO v_recipe_id;

  UPDATE public.products
  SET
    stock_control_type = 'RECIPE_CONTROLLED',
    updated_at = now()
  WHERE id = p_product_id AND company_id = p_company_id;

  INSERT INTO public.product_import_dashboard_review (
    company_id, product_id, review_bucket, resolution, resolved_at, resolved_by, updated_at
  )
  VALUES (
    p_company_id, p_product_id, 'EXIT_NO_ENTRY', 'CONVERTED_TO_TECH_SHEET', now(), auth.uid(), now()
  )
  ON CONFLICT (company_id, product_id, review_bucket) DO UPDATE SET
    resolution = 'CONVERTED_TO_TECH_SHEET',
    resolved_at = now(),
    resolved_by = auth.uid(),
    updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'recipe_id', v_recipe_id,
    'product_id', p_product_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'message', SQLERRM);
END;
$$;

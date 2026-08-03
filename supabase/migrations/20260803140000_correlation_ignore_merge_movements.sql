-- Correlação: ignorar movimentos sintéticos de unificação / desfazer unificação.

CREATE OR REPLACE FUNCTION public.dashboard_product_recipe_match_lists(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exit_only JSONB;
  v_entry_only JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('exit_only', '[]'::jsonb, 'entry_only', '[]'::jsonb);
  END IF;
  IF NOT (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
    )
  ) THEN
    RETURN jsonb_build_object('exit_only', '[]'::jsonb, 'entry_only', '[]'::jsonb);
  END IF;

  WITH exit_cand AS (
    SELECT
      p.id AS product_id,
      p.name,
      p.unit,
      p.sku,
      p.ean,
      p.barcode,
      p.current_quantity::double precision AS current_quantity,
      r.id AS recipe_id
    FROM public.products p
    LEFT JOIN public.recipes r
      ON r.company_id = p_company_id AND r.output_product_id = p.id AND r.active IS NOT FALSE
    WHERE p.company_id = p_company_id
      AND (p.is_active IS DISTINCT FROM false)
      AND EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.product_id = p.id
          AND sm.type = 'out'
          AND coalesce(sm.reference_type, '') NOT IN ('product_merge', 'product_merge_undo')
          AND (sm.metadata_json->>'undone_at') IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.product_id = p.id
          AND sm.type = 'in'
          AND coalesce(sm.reference_type, '') NOT IN ('product_merge', 'product_merge_undo')
          AND (sm.metadata_json->>'undone_at') IS NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.product_import_dashboard_review rev
        WHERE rev.company_id = p_company_id
          AND rev.product_id = p.id
          AND rev.review_bucket = 'EXIT_NO_ENTRY'
          AND rev.resolution = 'DISMISSED'
      )
  )
  SELECT coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_id', x.product_id,
          'name', x.name,
          'unit', x.unit,
          'sku', x.sku,
          'ean', x.ean,
          'barcode', x.barcode,
          'current_quantity', x.current_quantity,
          'recipe_id', x.recipe_id
        )
        ORDER BY x.name ASC
      )
      FROM (SELECT * FROM exit_cand ORDER BY name ASC LIMIT 120) x
    ),
    '[]'::jsonb
  )
  INTO v_exit_only;

  WITH entry_cand AS (
    SELECT
      p.id AS product_id,
      p.name,
      p.unit,
      p.sku,
      p.ean,
      p.barcode,
      p.current_quantity::double precision AS current_quantity
    FROM public.products p
    WHERE p.company_id = p_company_id
      AND (p.is_active IS DISTINCT FROM false)
      AND EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.product_id = p.id
          AND sm.type = 'in'
          AND coalesce(sm.reference_type, '') NOT IN ('product_merge', 'product_merge_undo')
          AND (sm.metadata_json->>'undone_at') IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.product_id = p.id
          AND sm.type = 'out'
          AND coalesce(sm.reference_type, '') NOT IN ('product_merge', 'product_merge_undo')
          AND (sm.metadata_json->>'undone_at') IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.recipes r
        WHERE r.company_id = p_company_id AND r.output_product_id = p.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.recipe_ingredients ri
        INNER JOIN public.recipes r ON r.id = ri.recipe_id AND r.company_id = p_company_id
        WHERE ri.product_id = p.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.product_import_dashboard_review rev
        WHERE rev.company_id = p_company_id
          AND rev.product_id = p.id
          AND rev.review_bucket = 'ENTRY_NO_EXIT'
          AND rev.resolution = 'DISMISSED'
      )
  )
  SELECT coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_id', x.product_id,
          'name', x.name,
          'unit', x.unit,
          'sku', x.sku,
          'ean', x.ean,
          'barcode', x.barcode,
          'current_quantity', x.current_quantity
        )
        ORDER BY x.name ASC
      )
      FROM (SELECT * FROM entry_cand ORDER BY name ASC LIMIT 120) x
    ),
    '[]'::jsonb
  )
  INTO v_entry_only;

  RETURN jsonb_build_object(
    'exit_only', coalesce(v_exit_only, '[]'::jsonb),
    'entry_only', coalesce(v_entry_only, '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.dashboard_product_recipe_match_lists(UUID) IS
  'Dashboard: produtos só com saída / só com entrada; ignora movimentos product_merge/product_merge_undo e undone_at; exclui dispensados.';

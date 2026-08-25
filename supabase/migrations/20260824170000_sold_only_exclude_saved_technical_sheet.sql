-- Correlação: produto com ficha já montada (insumos) não volta em sold_only.

CREATE OR REPLACE FUNCTION public.dashboard_product_recipe_match_lists(
  p_company_id UUID,
  p_purchase_limit INT DEFAULT 40,
  p_purchase_offset INT DEFAULT 0,
  p_sold_limit INT DEFAULT 80,
  p_sold_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchases JSONB;
  v_sold_only JSONB;
  v_purchases_total INT;
  v_purchases_without_util_total INT;
  v_sold_total INT;
  v_purchase_limit INT := coalesce(p_purchase_limit, 40);
  v_purchase_offset INT := GREATEST(coalesce(p_purchase_offset, 0), 0);
  v_sold_limit INT := coalesce(p_sold_limit, 80);
  v_sold_offset INT := GREATEST(coalesce(p_sold_offset, 0), 0);
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object(
      'purchases', '[]'::jsonb,
      'sold_only', '[]'::jsonb,
      'purchases_total', 0,
      'purchases_without_util_total', 0,
      'sold_total', 0
    );
  END IF;
  IF NOT (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.user_id = auth.uid() AND uc.company_id = p_company_id
    )
  ) THEN
    RETURN jsonb_build_object(
      'purchases', '[]'::jsonb,
      'sold_only', '[]'::jsonb,
      'purchases_total', 0,
      'purchases_without_util_total', 0,
      'sold_total', 0
    );
  END IF;

  WITH purchase_cand AS (
    SELECT
      p.id AS product_id,
      p.name,
      p.unit,
      p.sku,
      p.ean,
      p.barcode,
      p.current_quantity::double precision AS current_quantity,
      coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'tipo', 'FICHA_TECNICA',
            'idDestino', r.id,
            'nomeDestino', r.name
          )
          ORDER BY r.name ASC
        )
        FROM public.recipe_ingredients ri
        INNER JOIN public.recipes r
          ON r.id = ri.recipe_id
         AND r.company_id = p_company_id
        WHERE ri.product_id = p.id
      ), '[]'::jsonb) AS utilizations
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
        FROM public.product_import_dashboard_review rev
        WHERE rev.company_id = p_company_id
          AND rev.product_id = p.id
          AND rev.review_bucket = 'ENTRY_NO_EXIT'
          AND rev.resolution = 'DISMISSED'
      )
  ),
  purchase_counted AS (
    SELECT
      count(*)::int AS total,
      count(*) FILTER (WHERE jsonb_array_length(utilizations) = 0)::int AS without_util_total
    FROM purchase_cand
  ),
  purchase_page AS (
    SELECT *
    FROM purchase_cand
    WHERE v_purchase_limit > 0
    ORDER BY
      CASE WHEN jsonb_array_length(utilizations) = 0 THEN 0 ELSE 1 END,
      name ASC
    LIMIT GREATEST(v_purchase_limit, 0)
    OFFSET v_purchase_offset
  )
  SELECT
    c.total,
    c.without_util_total,
    coalesce(
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
            'utilizations', x.utilizations
          )
          ORDER BY
            CASE WHEN jsonb_array_length(x.utilizations) = 0 THEN 0 ELSE 1 END,
            x.name ASC
        )
        FROM purchase_page x
      ),
      '[]'::jsonb
    )
  INTO v_purchases_total, v_purchases_without_util_total, v_purchases
  FROM purchase_counted c;

  WITH sold_cand AS (
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
          AND rev.resolution IN ('DISMISSED', 'CONVERTED_TO_TECH_SHEET')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.recipes rx
        JOIN public.recipe_ingredients ri ON ri.recipe_id = rx.id
        WHERE rx.company_id = p_company_id
          AND rx.output_product_id = p.id
          AND rx.active IS NOT FALSE
      )
  ),
  sold_counted AS (
    SELECT count(*)::int AS total FROM sold_cand
  ),
  sold_page AS (
    SELECT *
    FROM sold_cand
    WHERE v_sold_limit > 0
    ORDER BY name ASC
    LIMIT GREATEST(v_sold_limit, 0)
    OFFSET v_sold_offset
  )
  SELECT
    c.total,
    coalesce(
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
        FROM sold_page x
      ),
      '[]'::jsonb
    )
  INTO v_sold_total, v_sold_only
  FROM sold_counted c;

  RETURN jsonb_build_object(
    'purchases', coalesce(v_purchases, '[]'::jsonb),
    'sold_only', coalesce(v_sold_only, '[]'::jsonb),
    'purchases_total', coalesce(v_purchases_total, 0),
    'purchases_without_util_total', coalesce(v_purchases_without_util_total, 0),
    'sold_total', coalesce(v_sold_total, 0)
  );
END;
$$;

COMMENT ON FUNCTION public.dashboard_product_recipe_match_lists(UUID, INT, INT, INT, INT) IS
  'Dashboard correlação: purchases/sold_only; omite vendas que já são ficha com insumos.';

GRANT EXECUTE ON FUNCTION public.dashboard_product_recipe_match_lists(UUID, INT, INT, INT, INT) TO authenticated;

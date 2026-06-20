-- "Entrada sem saída": LINK_RECIPE_STARTED não deve ocultar o item da fila.
-- O produto só deixa de aparecer quando existir receita (output_product_id) ou ao dispensar.

CREATE OR REPLACE FUNCTION public.dashboard_import_review_entry_no_exit_list(p_company_id UUID)
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
      AND pir.review_bucket = 'ENTRY_NO_EXIT'
      AND pir.resolution IN ('DISMISSED', 'CONVERTED_TO_TECH_SHEET')
  ),
  cand AS (
    SELECT
      p.id AS product_id,
      p.name,
      p.unit,
      p.current_quantity::double precision AS current_quantity,
      (
        EXISTS (
          SELECT 1 FROM public.onboarding_import_item_raw o
          WHERE o.company_id = p_company_id AND o.created_product_id = p.id
        )
        OR EXISTS (
          SELECT 1
          FROM public.expense_items ei
          JOIN public.expenses e ON e.id = ei.expense_id
          WHERE ei.product_id = p.id
            AND e.company_id = p_company_id
            AND (
              ei.import_engine_suggestion ILIKE '%XML%'
              OR ei.import_engine_suggestion = 'XML_CATALOG_MOTOR_APPLIED'
              OR ei.import_engine_suggestion = 'XML_CATALOG_MOTOR_PENDING'
            )
        )
      ) AS priority_import
    FROM public.products p
    WHERE p.company_id = p_company_id
      AND (p.is_active IS DISTINCT FROM false)
      AND (p.stock_control_type IS NULL OR p.stock_control_type IN ('DIRECT', 'COMPOSITE'))
      AND EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.product_id = p.id
          AND sm.type = 'in'
          AND sm.reference_type IN ('expense_item', 'import_breakdown')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_movements sm
        WHERE sm.product_id = p.id AND sm.type = 'out'
      )
      AND NOT EXISTS (SELECT 1 FROM reviewed r WHERE r.product_id = p.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.recipes r
        WHERE r.company_id = p_company_id AND r.output_product_id = p.id
      )
  )
  SELECT coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'product_id', x.product_id,
          'name', x.name,
          'unit', x.unit,
          'current_quantity', x.current_quantity,
          'priority_import', x.priority_import
        )
        ORDER BY x.priority_import DESC NULLS LAST, x.name ASC
      )
      FROM (
        SELECT * FROM cand
        ORDER BY priority_import DESC NULLS LAST, name ASC
        LIMIT 40
      ) x
    ),
    '[]'::jsonb
  )
  INTO v_out;

  RETURN coalesce(v_out, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.dashboard_import_review_entry_no_exit_list(UUID) IS
  'Dashboard: produtos com entrada de compra/import e sem saída; exclui dispensados e quem já tem receita de saída. Abrir fluxo de ficha (LINK_RECIPE_STARTED) não remove da fila.';

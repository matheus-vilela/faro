-- Remove reconciliação de catálogo no onboarding (tabelas legadas + pendências).

DELETE FROM public.import_review_pending
WHERE kind = 'catalog_reconciliation';

DROP TRIGGER IF EXISTS tr_onboarding_product_cluster_member_fill_company_id
  ON public.onboarding_product_cluster_member;

DROP FUNCTION IF EXISTS public.tg_fill_company_id_from_onboarding_cluster_id();

DROP TABLE IF EXISTS public.onboarding_product_cluster_member CASCADE;
DROP TABLE IF EXISTS public.onboarding_product_cluster CASCADE;
DROP TABLE IF EXISTS public.onboarding_catalog_decision_memory CASCADE;
DROP TABLE IF EXISTS public.onboarding_import_item_raw CASCADE;
DROP TABLE IF EXISTS public.onboarding_reconciliation_runs CASCADE;

-- ---------------------------------------------------------------------------
-- import_review_pending: remove kind catalog_reconciliation
-- ---------------------------------------------------------------------------
ALTER TABLE public.import_review_pending
  DROP CONSTRAINT IF EXISTS import_review_pending_kind_check;

ALTER TABLE public.import_review_pending
  ADD CONSTRAINT import_review_pending_kind_check
  CHECK (kind IN (
    'missing_conversion',
    'missing_category',
    'unit_conflict',
    'possible_duplicate',
    'missing_product_match'
  ));

-- ---------------------------------------------------------------------------
-- finalize_onboarding_xml_recebimento: sem onboarding_import_item_raw
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_onboarding_xml_recebimento_for_expense(p_expense_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_rec_id UUID;
  v_rec_status TEXT;
  v_row RECORD;
  v_item_status TEXT;
  v_qty_rec NUMERIC;
  v_synced INTEGER := 0;
BEGIN
  SELECT e.company_id
  INTO v_company_id
  FROM public.expenses e
  WHERE e.id = p_expense_id;

  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expense_not_found');
  END IF;

  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_companies uc
      WHERE uc.user_id = auth.uid() AND uc.company_id = v_company_id
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.expenses e
    WHERE e.id = p_expense_id
      AND (
        e.financial_reconciliation_json->>'source' = 'focus_get_sync_nfe_interpret_staging'
        OR EXISTS (
          SELECT 1
          FROM public.expense_items ei
          WHERE ei.expense_id = e.id
            AND (
              ei.import_engine_suggestion ILIKE '%XML%'
              OR ei.import_engine_suggestion IN (
                'XML_CATALOG_MOTOR_APPLIED',
                'XML_CATALOG_MOTOR_PENDING'
              )
            )
        )
      )
  ) THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'not_onboarding_xml_expense');
  END IF;

  SELECT r.id, r.status
  INTO v_rec_id, v_rec_status
  FROM public.recebimentos r
  WHERE r.expense_id = p_expense_id
  LIMIT 1;

  IF v_rec_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'recebimento_not_found');
  END IF;

  IF v_rec_status = 'received' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'already_received');
  END IF;

  FOR v_row IN
    SELECT
      ei.id,
      ei.quantity,
      ei.stock_quantity,
      ei.product_id,
      COALESCE(ei.stock_added, false) AS stock_added,
      COALESCE(ei.import_pending_resolution, false) AS import_pending_resolution,
      ei.import_stock_resolution
    FROM public.expense_items ei
    WHERE ei.expense_id = p_expense_id
  LOOP
    IF v_row.product_id IS NULL OR COALESCE(v_row.quantity, 0) <= 0 THEN
      v_item_status := 'not_received';
      v_qty_rec := 0::numeric;
    ELSIF COALESCE(v_row.stock_added, false) THEN
      v_item_status := 'received';
      v_qty_rec := COALESCE(v_row.stock_quantity, v_row.quantity);
    ELSIF
      NOT v_row.import_pending_resolution
      AND (
        v_row.import_stock_resolution IS NULL
        OR v_row.import_stock_resolution IS DISTINCT FROM 'EXPLODE_BY_RECIPE'
      )
    THEN
      v_item_status := 'received';
      v_qty_rec := COALESCE(v_row.stock_quantity, v_row.quantity);
    ELSE
      v_item_status := 'not_received';
      v_qty_rec := 0::numeric;
    END IF;

    INSERT INTO public.recebimento_item_status (
      recebimento_id,
      expense_item_id,
      status,
      quantity_received
    )
    VALUES (
      v_rec_id,
      v_row.id,
      v_item_status,
      v_qty_rec
    )
    ON CONFLICT (recebimento_id, expense_item_id) DO UPDATE SET
      status = EXCLUDED.status,
      quantity_received = EXCLUDED.quantity_received;

    v_synced := v_synced + 1;
  END LOOP;

  UPDATE public.recebimentos
  SET
    status = 'received',
    received_at = now()
  WHERE id = v_rec_id;

  RETURN jsonb_build_object('ok', true, 'items_synced', v_synced);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', 'exception', 'message', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.finalize_onboarding_xml_recebimento_for_expense(UUID) IS
  'Onboarding XML (Focus interpret): marca recebimento concluído; sincroniza linhas com stock ou catálogo sem pendência.';

-- ---------------------------------------------------------------------------
-- purge_company_onboarding_xml_expenses: despesas do interpret staging
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_company_onboarding_xml_expenses(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_deleted int := 0;
  v_candidates int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_companies uc
    WHERE uc.user_id = v_uid
      AND uc.company_id = p_company_id
      AND uc.role = 'owner'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.companies c WHERE c.id = p_company_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'company_not_found');
  END IF;

  SELECT count(*)::int
  INTO v_candidates
  FROM public.expenses e
  WHERE e.company_id = p_company_id
    AND e.financial_reconciliation_json->>'source' = 'focus_get_sync_nfe_interpret_staging';

  IF v_candidates = 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'no_onboarding_xml_expenses',
      'message', 'Não há despesas de importação NF-e (Focus interpret) nesta unidade.'
    );
  END IF;

  DELETE FROM public.expenses e
  WHERE e.company_id = p_company_id
    AND e.financial_reconciliation_json->>'source' = 'focus_get_sync_nfe_interpret_staging';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_count', v_deleted,
    'candidate_count', v_candidates
  );
END;
$fn$;

COMMENT ON FUNCTION public.purge_company_onboarding_xml_expenses(uuid) IS
  'Proprietário: apaga despesas criadas pelo interpret NF-e do onboarding (focus_get_sync_nfe_interpret_staging).';

-- ---------------------------------------------------------------------------
-- dashboard_import_review_entry_no_exit_list: sem onboarding_import_item_raw
-- ---------------------------------------------------------------------------
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
      EXISTS (
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
      AND NOT EXISTS (
        SELECT 1
        FROM public.recipe_ingredients ri
        INNER JOIN public.recipes r ON r.id = ri.recipe_id AND r.company_id = p_company_id
        WHERE ri.product_id = p.id
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

-- Remove pipeline legado de importação XML em lote (import_job_*), logs NF-e por lote
-- (company_nfe_import_logs) e trilha do motor XML (expense_xml_item_motor_pass).
-- Fluxo atual: focus_get_sync_nfe_staging → focus_get_sync_nfe_interpret_jobs.

-- ---------------------------------------------------------------------------
-- 1) Backfill onboarding fiscal (substitui uso de company_nfe_import_logs)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.company_nfe_import_logs') IS NOT NULL THEN
    UPDATE public.companies c
    SET onboarding_fiscal =
      COALESCE(c.onboarding_fiscal, '{}'::jsonb) || jsonb_build_object('completed', true)
    WHERE NOT public.onboarding_fiscal_json_completed(COALESCE(c.onboarding_fiscal, '{}'::jsonb))
      AND EXISTS (
        SELECT 1
        FROM public.company_nfe_import_logs l
        WHERE l.company_id = c.id
      );
  END IF;
END $$;

UPDATE public.companies c
SET onboarding_fiscal =
  COALESCE(c.onboarding_fiscal, '{}'::jsonb) || jsonb_build_object('completed', true)
WHERE NOT public.onboarding_fiscal_json_completed(COALESCE(c.onboarding_fiscal, '{}'::jsonb))
  AND (
    EXISTS (
      SELECT 1
      FROM public.focus_get_sync_nfe_staging s
      WHERE s.company_id = c.id
    )
    OR EXISTS (
      SELECT 1
      FROM public.expenses e
      WHERE e.company_id = c.id
        AND e.financial_reconciliation_json->>'source' = 'focus_get_sync_nfe_interpret_staging'
    )
  );

-- ---------------------------------------------------------------------------
-- 2) purge_company_onboarding_xml_expenses (sem company_nfe_import_logs)
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
    SELECT 1
    FROM public.companies c
    WHERE c.id = p_company_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'company_not_found');
  END IF;

  SELECT count(DISTINCT ei.expense_id)::int
  INTO v_candidates
  FROM public.onboarding_import_item_raw o
  INNER JOIN public.expense_items ei ON ei.id = o.expense_item_id
  WHERE o.company_id = p_company_id
    AND ei.expense_id IS NOT NULL;

  IF v_candidates = 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'no_onboarding_xml_expenses',
      'message', 'Não há despesas de importação XML do onboarding vinculadas a itens brutos nesta unidade.'
    );
  END IF;

  DELETE FROM public.expenses e
  WHERE e.company_id = p_company_id
    AND e.id IN (
      SELECT DISTINCT ei.expense_id
      FROM public.onboarding_import_item_raw o
      INNER JOIN public.expense_items ei ON ei.id = o.expense_item_id
      WHERE o.company_id = p_company_id
        AND ei.expense_id IS NOT NULL
    );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_count', v_deleted,
    'candidate_count', v_candidates
  );
END;
$fn$;

COMMENT ON FUNCTION public.purge_company_onboarding_xml_expenses(uuid) IS
  'Proprietário: apaga despesas vinculadas a linhas de onboarding_import_item_raw (importação XML/ZIP do onboarding).';

-- ---------------------------------------------------------------------------
-- 3) Desvincular FKs opcionais antes do DROP (idempotente)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'import_review_pending'
      AND column_name = 'batch_id'
  ) THEN
    UPDATE public.import_review_pending
    SET batch_id = NULL,
        file_id = NULL
    WHERE batch_id IS NOT NULL
       OR file_id IS NOT NULL;

    ALTER TABLE public.import_review_pending
      DROP COLUMN IF EXISTS batch_id,
      DROP COLUMN IF EXISTS file_id;
  END IF;
END $$;

ALTER TABLE public.onboarding_import_item_raw
  DROP COLUMN IF EXISTS import_job_batch_id,
  DROP COLUMN IF EXISTS import_job_file_id,
  DROP COLUMN IF EXISTS import_job_item_id;

-- ---------------------------------------------------------------------------
-- 4) Sync manual Focus (focus-sync-nfe-recebidas): funções RPC + fila
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS func_name,
      pg_get_function_identity_arguments(p.oid) AS func_args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (
        p.proname ILIKE '%focus_nfe_recebidas%'
        OR EXISTS (
          SELECT 1
          FROM pg_depend d
          JOIN pg_type t ON t.oid = d.refobjid
          WHERE d.objid = p.oid
            AND t.typname = 'focus_nfe_recebidas_sync_queue'
        )
      )
  LOOP
    EXECUTE format(
      'DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE',
      r.schema_name,
      r.func_name,
      r.func_args
    );
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.claim_focus_nfe_recebidas_queue(uuid, integer) CASCADE;

DROP TABLE IF EXISTS public.focus_nfe_recebidas_sync_queue CASCADE;

-- ---------------------------------------------------------------------------
-- 5) DROP pipeline XML em lote (import_job_* + logs + motor)
-- company_nfe_import_logs referencia import_job_batches/files — antes deles.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.import_job_timeline;
DROP TABLE IF EXISTS public.import_job_items;
DROP TABLE IF EXISTS public.company_nfe_import_logs;
DROP TABLE IF EXISTS public.import_job_files;
DROP TABLE IF EXISTS public.import_job_batches;
DROP TABLE IF EXISTS public.expense_xml_item_motor_pass;

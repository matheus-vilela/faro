-- Remove despesas criadas pelo lote de importação XML/ZIP guardado no onboarding (`setup.xml_zip_import.job_batch_id`).

CREATE OR REPLACE FUNCTION public.purge_company_onboarding_xml_expenses(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_batch uuid;
  v_setup jsonb;
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

  SELECT to_jsonb(c.setup)
  INTO v_setup
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF v_setup IS NULL OR v_setup = 'null'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'error', 'company_not_found');
  END IF;

  BEGIN
    v_batch := NULLIF(trim(v_setup #>> '{xml_zip_import,job_batch_id}'), '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      v_batch := NULL;
  END;

  IF v_batch IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'no_onboarding_xml_batch',
      'message', 'Não há identificador de lote de importação XML do onboarding nesta unidade.'
    );
  END IF;

  SELECT count(*)::int
  INTO v_candidates
  FROM public.company_nfe_import_logs l
  WHERE l.company_id = p_company_id
    AND l.import_job_batch_id = v_batch
    AND l.expense_id IS NOT NULL;

  DELETE FROM public.expenses e
  WHERE e.company_id = p_company_id
    AND e.id IN (
      SELECT DISTINCT l.expense_id
      FROM public.company_nfe_import_logs l
      WHERE l.company_id = p_company_id
        AND l.import_job_batch_id = v_batch
        AND l.expense_id IS NOT NULL
    );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_count', v_deleted,
    'candidate_count', v_candidates,
    'batch_id', v_batch
  );
END;
$fn$;

COMMENT ON FUNCTION public.purge_company_onboarding_xml_expenses(uuid) IS
  'Proprietário: apaga despesas vinculadas ao lote `setup.xml_zip_import.job_batch_id` (importação NF-e do onboarding).';

REVOKE ALL ON FUNCTION public.purge_company_onboarding_xml_expenses(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_company_onboarding_xml_expenses(uuid) TO authenticated;

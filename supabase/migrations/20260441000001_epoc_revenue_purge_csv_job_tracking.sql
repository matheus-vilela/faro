-- Melhora o purge de receitas EPOC/CSV: rastreio por job + provider case-insensitive,
-- e funcoes em SECURITY INVOKER para alinhar RLS com o utilizador da sessao.

ALTER TABLE public.revenue_entries
  ADD COLUMN IF NOT EXISTS integration_csv_import_job_id UUID
  REFERENCES public.integration_csv_revenue_import_jobs(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.revenue_entries.integration_csv_import_job_id IS
  'Job CSV (ex. EPOC) que originou o lancamento; mantem-se se o lote for apagado (SET NULL no lote).';

CREATE INDEX IF NOT EXISTS idx_revenue_entries_integration_csv_import_job_id
  ON public.revenue_entries (integration_csv_import_job_id)
  WHERE integration_csv_import_job_id IS NOT NULL;

UPDATE public.revenue_entries re
SET integration_csv_import_job_id = NULLIF(trim(b.metadata->>'csv_import_job_id'), '')::uuid
FROM public.company_revenue_integration_import_batches b
WHERE re.integration_import_batch_id = b.id
  AND re.integration_csv_import_job_id IS NULL
  AND b.metadata ? 'csv_import_job_id'
  AND NULLIF(trim(b.metadata->>'csv_import_job_id'), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.revenue_entries_stamp_csv_import_job_from_batch()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.integration_import_batch_id IS NOT NULL THEN
    SELECT NULLIF(trim(b.metadata->>'csv_import_job_id'), '')::uuid
    INTO NEW.integration_csv_import_job_id
    FROM public.company_revenue_integration_import_batches b
    WHERE b.id = NEW.integration_import_batch_id;
  ELSE
    NEW.integration_csv_import_job_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_revenue_entries_stamp_csv_import_job ON public.revenue_entries;
CREATE TRIGGER tr_revenue_entries_stamp_csv_import_job
  BEFORE INSERT OR UPDATE OF integration_import_batch_id ON public.revenue_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.revenue_entries_stamp_csv_import_job_from_batch();


CREATE OR REPLACE FUNCTION public.count_revenue_entries_from_integration_import(
  p_company_id UUID,
  p_provider TEXT DEFAULT 'epoc'
)
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = v_uid AND uc.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Sem permissao para esta empresa';
  END IF;

  IF p_provider IS NULL OR btrim(p_provider) = '' THEN
    RAISE EXCEPTION 'Informe o provedor da integracao';
  END IF;

  RETURN (
    SELECT count(*)::bigint
    FROM public.revenue_entries re
    WHERE re.company_id = p_company_id
      AND (
        EXISTS (
          SELECT 1
          FROM public.company_revenue_integration_import_batches b
          WHERE b.id = re.integration_import_batch_id
            AND lower(trim(b.provider)) = lower(trim(p_provider))
        )
        OR (
          re.integration_csv_import_job_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.integration_csv_revenue_import_jobs j
            WHERE j.id = re.integration_csv_import_job_id
              AND j.company_id = re.company_id
              AND lower(trim(j.provider)) = lower(trim(p_provider))
          )
        )
      )
  );
END;
$$;

COMMENT ON FUNCTION public.count_revenue_entries_from_integration_import(UUID, TEXT) IS
  'Conta receitas da empresa ligadas a lotes CSV ou ao job de import (provider, case-insensitive).';

GRANT EXECUTE ON FUNCTION public.count_revenue_entries_from_integration_import(UUID, TEXT) TO authenticated;


CREATE OR REPLACE FUNCTION public.delete_revenue_entries_from_integration_import(
  p_company_id UUID,
  p_provider TEXT DEFAULT 'epoc'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_count INTEGER := 0;
  r RECORD;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sessao invalida';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_companies uc
    WHERE uc.user_id = v_uid AND uc.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Sem permissao para esta empresa';
  END IF;

  IF p_provider IS NULL OR btrim(p_provider) = '' THEN
    RAISE EXCEPTION 'Informe o provedor da integracao';
  END IF;

  FOR r IN
    SELECT re.id
    FROM public.revenue_entries re
    WHERE re.company_id = p_company_id
      AND (
        EXISTS (
          SELECT 1
          FROM public.company_revenue_integration_import_batches b
          WHERE b.id = re.integration_import_batch_id
            AND lower(trim(b.provider)) = lower(trim(p_provider))
        )
        OR (
          re.integration_csv_import_job_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.integration_csv_revenue_import_jobs j
            WHERE j.id = re.integration_csv_import_job_id
              AND j.company_id = re.company_id
              AND lower(trim(j.provider)) = lower(trim(p_provider))
          )
        )
      )
    ORDER BY re.id
  LOOP
    PERFORM public.delete_revenue_entry(r.id);
    v_count := v_count + 1;
  END LOOP;

  DELETE FROM public.company_revenue_integration_import_batches b
  WHERE b.company_id = p_company_id
    AND lower(trim(b.provider)) = lower(trim(p_provider));

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.delete_revenue_entries_from_integration_import(UUID, TEXT) IS
  'Remove receitas ligadas a lotes ou jobs CSV do provider; apaga lotes; reutiliza delete_revenue_entry.';

GRANT EXECUTE ON FUNCTION public.delete_revenue_entries_from_integration_import(UUID, TEXT) TO authenticated;

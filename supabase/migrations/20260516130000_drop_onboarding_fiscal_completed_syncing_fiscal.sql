-- Fonte única: `companies.onboarding_fiscal` (completed, sync, métricas).
-- Remove colunas duplicadas `onboarding_fiscal_completed` e `syncing_fiscal`.

CREATE OR REPLACE FUNCTION public.onboarding_fiscal_json_completed(ob jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE((ob->>'completed')::boolean, false);
$$;

COMMENT ON FUNCTION public.onboarding_fiscal_json_completed(jsonb) IS
  'True quando onboarding_fiscal.completed.';

-- Backfill JSON antes de remover colunas
UPDATE public.companies c
SET onboarding_fiscal =
  coalesce(c.onboarding_fiscal, '{}'::jsonb) || jsonb_build_object('completed', true)
WHERE c.onboarding_fiscal_completed IS TRUE
  AND NOT public.onboarding_fiscal_json_completed(coalesce(c.onboarding_fiscal, '{}'::jsonb));

UPDATE public.companies c
SET onboarding_fiscal =
  coalesce(c.onboarding_fiscal, '{}'::jsonb) || jsonb_build_object('completed', true)
WHERE EXISTS (
  SELECT 1
  FROM public.company_nfe_import_logs l
  WHERE l.company_id = c.id
)
AND NOT public.onboarding_fiscal_json_completed(coalesce(c.onboarding_fiscal, '{}'::jsonb));

CREATE OR REPLACE FUNCTION public.companies_recompute_onboarding_completed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.onboarding_completed :=
    COALESCE((NEW.setup->>'status') = 'completed', false)
    AND public.onboarding_fiscal_json_completed(COALESCE(NEW.onboarding_fiscal, '{}'::jsonb))
    AND NEW.onboarding_integration_pdv_completed IS TRUE;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_companies_recompute_onboarding_completed ON public.companies;
CREATE TRIGGER tr_companies_recompute_onboarding_completed
  BEFORE INSERT OR UPDATE OF setup, onboarding_fiscal, onboarding_integration_pdv_completed
  ON public.companies
  FOR EACH ROW
  EXECUTE PROCEDURE public.companies_recompute_onboarding_completed();

-- Recomputar onboarding_completed para linhas existentes
UPDATE public.companies c
SET onboarding_completed =
  COALESCE((c.setup->>'status') = 'completed', false)
  AND public.onboarding_fiscal_json_completed(COALESCE(c.onboarding_fiscal, '{}'::jsonb))
  AND c.onboarding_integration_pdv_completed IS TRUE;

ALTER TABLE public.companies
  DROP COLUMN IF EXISTS onboarding_fiscal_completed,
  DROP COLUMN IF EXISTS syncing_fiscal;

COMMENT ON COLUMN public.companies.onboarding_fiscal IS
  'Onboarding fiscal: sync, max_nfes_sync, nfes_sync, nfes_ignored, completed (etapa concluída; substitui onboarding_fiscal_completed).';

-- PDV/onboarding EPOC: `onboarding_pdv` JSON (completed, sync).
-- Remove colunas legadas e campos obsoletos em companies.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS onboarding_pdv JSONB NOT NULL DEFAULT jsonb_build_object(
    'completed', false,
    'sync', false
  );

COMMENT ON COLUMN public.companies.onboarding_pdv IS
  'Onboarding PDV/EPOC: completed (etapa concluída), sync (sincronização CSV em curso).';

-- Backfill a partir das colunas booleanas
UPDATE public.companies c
SET onboarding_pdv = jsonb_build_object(
  'completed', COALESCE(c.onboarding_integration_pdv_completed, false),
  'sync', COALESCE(c.syncing_pdv, false)
);

-- Representante legal → setup (antes de dropar coluna)
UPDATE public.companies c
SET setup = COALESCE(c.setup, '{}'::jsonb) || jsonb_build_object(
  'representante_legal', c.representante_legal
)
WHERE c.representante_legal IS NOT NULL
  AND c.representante_legal <> '{}'::jsonb
  AND NOT COALESCE(c.setup, '{}'::jsonb) ? 'representante_legal';

CREATE OR REPLACE FUNCTION public.onboarding_pdv_json_completed(ob jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE((ob->>'completed')::boolean, false);
$$;

COMMENT ON FUNCTION public.onboarding_pdv_json_completed(jsonb) IS
  'True quando onboarding_pdv.completed.';

CREATE OR REPLACE FUNCTION public.companies_recompute_onboarding_completed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.onboarding_completed :=
    COALESCE((NEW.setup->>'status') = 'completed', false)
    AND public.onboarding_fiscal_json_completed(COALESCE(NEW.onboarding_fiscal, '{}'::jsonb))
    AND public.onboarding_pdv_json_completed(COALESCE(NEW.onboarding_pdv, '{}'::jsonb));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_companies_recompute_onboarding_completed ON public.companies;
CREATE TRIGGER tr_companies_recompute_onboarding_completed
  BEFORE INSERT OR UPDATE OF setup, onboarding_fiscal, onboarding_pdv
  ON public.companies
  FOR EACH ROW
  EXECUTE PROCEDURE public.companies_recompute_onboarding_completed();

UPDATE public.companies c
SET onboarding_completed =
  COALESCE((c.setup->>'status') = 'completed', false)
  AND public.onboarding_fiscal_json_completed(COALESCE(c.onboarding_fiscal, '{}'::jsonb))
  AND public.onboarding_pdv_json_completed(COALESCE(c.onboarding_pdv, '{}'::jsonb));

ALTER TABLE public.companies
  DROP COLUMN IF EXISTS representante_legal,
  DROP COLUMN IF EXISTS onboarding_catalog_reconciliation_completed_at,
  DROP COLUMN IF EXISTS address,
  DROP COLUMN IF EXISTS onboarding_integration_pdv_completed,
  DROP COLUMN IF EXISTS syncing_pdv;

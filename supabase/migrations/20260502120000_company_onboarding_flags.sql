-- Flags persistidas de onboarding por empresa: decisão de layout/carregamento no dashboard.
-- onboarding_completed é sempre derivado no banco (trigger); não persistir manualmente pelo cliente.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_fiscal_completed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_integration_pdv_completed BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.companies.onboarding_completed IS
  'True quando o assistente (setup.status=completed), fiscal e integração PDV estão concluídos; mantido por trigger.';
COMMENT ON COLUMN public.companies.onboarding_fiscal_completed IS
  'Etapa fiscal (NF-e recebidas / importação) concluída pelo utilizador ou dados na base.';
COMMENT ON COLUMN public.companies.onboarding_integration_pdv_completed IS
  'Etapa PDV/EPOC concluída (sem PDV no wizard, ou ação explícita no dashboard).';

CREATE OR REPLACE FUNCTION public.companies_recompute_onboarding_completed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.onboarding_completed :=
    COALESCE((NEW.setup->>'status') = 'completed', false)
    AND NEW.onboarding_fiscal_completed IS TRUE
    AND NEW.onboarding_integration_pdv_completed IS TRUE;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_companies_recompute_onboarding_completed ON public.companies;
CREATE TRIGGER tr_companies_recompute_onboarding_completed
  BEFORE INSERT OR UPDATE OF setup, onboarding_fiscal_completed, onboarding_integration_pdv_completed
  ON public.companies
  FOR EACH ROW
  EXECUTE PROCEDURE public.companies_recompute_onboarding_completed();

-- Unidades que já concluíram o assistente sem PDV.
UPDATE public.companies
SET onboarding_integration_pdv_completed = true
WHERE (setup->'epoc'->>'mode') = 'no'
  AND (setup->>'status') = 'completed';

-- Já existem NF-e importadas: tratar etapa fiscal como satisfeita.
UPDATE public.companies c
SET onboarding_fiscal_completed = true
WHERE EXISTS (
  SELECT 1
  FROM public.company_nfe_import_logs l
  WHERE l.company_id = c.id
);

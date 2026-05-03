-- Travas `syncing_fiscal` / `syncing_pdv` controladas pela app (onboarding).
-- UPDATE permitido a quem já pode atualizar `companies` (RLS).

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS syncing_fiscal BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS syncing_pdv BOOLEAN NOT NULL DEFAULT false;

DROP TRIGGER IF EXISTS tr_companies_enforce_syncing_flags ON public.companies;
DROP FUNCTION IF EXISTS public.companies_enforce_syncing_flags_service_role();

DROP FUNCTION IF EXISTS public.try_claim_company_fiscal_sync(uuid);
DROP FUNCTION IF EXISTS public.release_company_fiscal_sync(uuid);
DROP FUNCTION IF EXISTS public.try_claim_company_pdv_sync(uuid);
DROP FUNCTION IF EXISTS public.release_company_pdv_sync(uuid);

COMMENT ON COLUMN public.companies.syncing_fiscal IS
  'True enquanto o onboarding fiscal mantém sincronização manual NF-e recebidas ativa (UI desativa outros disparos).';
COMMENT ON COLUMN public.companies.syncing_pdv IS
  'True enquanto o onboarding PDV mantém sincronização EPOC ativa (UI desativa disparos manuais).';

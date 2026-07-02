CREATE TABLE IF NOT EXISTS public.company_bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('corrente', 'poupanca', 'outro')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT company_bank_accounts_company_name_unique UNIQUE (company_id, name)
);

CREATE INDEX IF NOT EXISTS idx_company_bank_accounts_company
  ON public.company_bank_accounts (company_id);

COMMENT ON TABLE public.company_bank_accounts IS
  'Contas bancárias cadastradas por empresa (nome e tipo).';

DROP TRIGGER IF EXISTS tr_company_bank_accounts_updated_at
  ON public.company_bank_accounts;
CREATE TRIGGER tr_company_bank_accounts_updated_at
  BEFORE UPDATE ON public.company_bank_accounts
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.company_bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage company bank accounts"
  ON public.company_bank_accounts;
CREATE POLICY "Users can manage company bank accounts"
  ON public.company_bank_accounts FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

GRANT ALL ON public.company_bank_accounts TO anon, authenticated;

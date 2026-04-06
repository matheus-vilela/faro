-- Integrações externas por empresa (credenciais em settings; acesso restrito a gestor/owner via RLS)
CREATE TABLE IF NOT EXISTS public.company_integrations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_company_integrations_company
  ON public.company_integrations (company_id);

ALTER TABLE public.company_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Gestor e owner gerenciam integrações da empresa"
  ON public.company_integrations FOR ALL
  USING (
    company_id IN (
      SELECT uc.company_id
      FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
        AND uc.role IN ('owner', 'gestor')
    )
  )
  WITH CHECK (
    company_id IN (
      SELECT uc.company_id
      FROM public.user_companies uc
      WHERE uc.user_id = auth.uid()
        AND uc.role IN ('owner', 'gestor')
    )
  );

GRANT ALL ON public.company_integrations TO anon, authenticated;

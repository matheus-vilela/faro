-- Alertas persistidos por empresa (sincronizados a partir de regras de negócio)
CREATE TABLE IF NOT EXISTS public.company_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('low_stock', 'expense_no_boleto', 'recebimento_falta')),
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'danger')),
  dedupe_key TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  link_path TEXT,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed')),
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_company_alerts_company_status
  ON public.company_alerts (company_id, status);
CREATE INDEX IF NOT EXISTS idx_company_alerts_company_created
  ON public.company_alerts (company_id, created_at DESC);

ALTER TABLE public.company_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage company alerts for their companies"
  ON public.company_alerts FOR ALL
  USING (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  )
  WITH CHECK (
    company_id IN (SELECT company_id FROM public.user_companies WHERE user_id = auth.uid())
  );

GRANT ALL ON public.company_alerts TO anon, authenticated;

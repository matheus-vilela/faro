-- Métricas de progresso do import CSV EPOC no onboarding PDV (espelho de onboarding_fiscal).

UPDATE public.companies c
SET onboarding_pdv = coalesce(c.onboarding_pdv, '{}'::jsonb) || jsonb_build_object(
  'sales_total', 0,
  'sales_sync', 0
)
WHERE NOT (coalesce(c.onboarding_pdv, '{}'::jsonb) ? 'sales_total')
   OR NOT (coalesce(c.onboarding_pdv, '{}'::jsonb) ? 'sales_sync');

ALTER TABLE public.companies
  ALTER COLUMN onboarding_pdv SET DEFAULT jsonb_build_object(
    'completed', false,
    'sync', false,
    'sales_total', 0,
    'sales_sync', 0
  );

COMMENT ON COLUMN public.companies.onboarding_pdv IS
  'Onboarding PDV/EPOC: completed, sync, sales_total, sales_sync (ver migrations posteriores para portal/import).';

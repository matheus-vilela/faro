-- Unifica `interpret_confirmed` em `onboarding_fiscal.completed` (fonte única no JSON).

UPDATE public.companies c
SET onboarding_fiscal =
  (coalesce(c.onboarding_fiscal, '{}'::jsonb) - 'interpret_confirmed')
  || jsonb_build_object(
    'completed',
    CASE
      WHEN coalesce(c.onboarding_fiscal->>'completed', 'false') = 'true' THEN true
      WHEN coalesce(c.onboarding_fiscal->>'interpret_confirmed', 'false') = 'true' THEN true
      ELSE false
    END
  )
WHERE coalesce(c.onboarding_fiscal, '{}'::jsonb) ? 'interpret_confirmed';

COMMENT ON COLUMN public.companies.onboarding_fiscal IS
  'Onboarding fiscal: sync, max_nfes_sync, nfes_sync, nfes_ignored, completed (etapa concluída; alinhar com onboarding_fiscal_completed).';

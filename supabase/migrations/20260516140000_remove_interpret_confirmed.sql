-- Remove chave legada `interpret_confirmed` de onboarding_fiscal (substituída por `completed`).

UPDATE public.companies c
SET onboarding_fiscal =
  (coalesce(c.onboarding_fiscal, '{}'::jsonb) - 'interpret_confirmed')
  || CASE
    WHEN coalesce(c.onboarding_fiscal->>'interpret_confirmed', 'false') = 'true'
      AND coalesce(c.onboarding_fiscal->>'completed', 'false') <> 'true'
    THEN jsonb_build_object('completed', true)
    ELSE '{}'::jsonb
  END
WHERE coalesce(c.onboarding_fiscal, '{}'::jsonb) ? 'interpret_confirmed';

CREATE OR REPLACE FUNCTION public.onboarding_fiscal_json_completed(ob jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE((ob->>'completed')::boolean, false);
$$;

COMMENT ON FUNCTION public.onboarding_fiscal_json_completed(jsonb) IS
  'True quando onboarding_fiscal.completed.';

COMMENT ON COLUMN public.companies.onboarding_fiscal IS
  'Onboarding fiscal: sync, max_nfes_sync, nfes_sync, nfes_ignored, completed.';

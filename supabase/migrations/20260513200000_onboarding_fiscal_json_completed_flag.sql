-- Campo `completed` dentro de `companies.onboarding_fiscal` (false até concluir o fluxo fiscal no produto).

update public.companies
set onboarding_fiscal = onboarding_fiscal || jsonb_build_object('completed', false)
where not (onboarding_fiscal ? 'completed');

alter table public.companies
  alter column onboarding_fiscal set default jsonb_build_object(
    'sync', true,
    'max_nfes_sync', 0,
    'nfes_sync', 0,
    'nfes_ignored', 0,
    'completed', false
  );

comment on column public.companies.onboarding_fiscal is
  'Onboarding fiscal: sync, max_nfes_sync, nfes_sync, nfes_ignored, completed (false até concluir; alinhar com onboarding_fiscal_completed).';

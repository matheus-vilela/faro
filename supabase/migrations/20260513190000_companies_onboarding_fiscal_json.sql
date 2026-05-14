-- Progresso de onboarding fiscal (listagem Focus / sync resumido): visibilidade e métricas no dashboard.

alter table public.companies
  add column if not exists onboarding_fiscal jsonb not null default jsonb_build_object(
    'sync', true,
    'max_nfes_sync', 0,
    'nfes_sync', 0,
    'nfes_ignored', 0
  );

comment on column public.companies.onboarding_fiscal is
  'Onboarding fiscal: sync (exibir card de NF-e), max_nfes_sync (total estimado na 1.ª lista Focus), nfes_sync e nfes_ignored (progresso; atualização futura).';

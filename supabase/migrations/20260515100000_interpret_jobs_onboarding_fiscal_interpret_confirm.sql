-- Job de interpretação: flag onboarding (para atualizar métricas em companies.onboarding_fiscal).
-- JSON fiscal: interpret_confirmed — utilizador confirma no dashboard após interpretação concluída.

alter table public.focus_get_sync_nfe_interpret_jobs
  add column if not exists onboarding boolean not null default false;

comment on column public.focus_get_sync_nfe_interpret_jobs.onboarding is
  'True quando o sync Focus foi pedido com onboarding; a Edge incrementa onboarding_fiscal.nfes_sync por fatia e, ao terminar, define sync=false até o utilizador marcar interpret_confirmed.';

update public.companies c
set onboarding_fiscal = coalesce(c.onboarding_fiscal, '{}'::jsonb) || jsonb_build_object('interpret_confirmed', false)
where not (coalesce(c.onboarding_fiscal, '{}'::jsonb) ? 'interpret_confirmed');

alter table public.companies
  alter column onboarding_fiscal set default jsonb_build_object(
    'sync', true,
    'max_nfes_sync', 0,
    'nfes_sync', 0,
    'nfes_ignored', 0,
    'completed', false,
    'interpret_confirmed', false
  );

comment on column public.companies.onboarding_fiscal is
  'Onboarding fiscal: sync, max_nfes_sync, nfes_sync, nfes_ignored, completed, interpret_confirmed (após interpretação XML no onboarding).';

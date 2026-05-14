-- Staging para inspeção do resultado de `focus-get-sync-nfe` (listagem resumida na Focus).
-- Linhas expiram em 7 dias (limpeza opcional por job ou SQL manual).

create table if not exists public.focus_get_sync_nfe_staging (
  id uuid primary key default gen_random_uuid(),
  exec_id uuid not null,
  company_id uuid not null references public.companies (id) on delete cascade,
  cnpj text not null,
  chave_nfe text not null,
  versao_nf bigint,
  situacao text,
  nfe_completa boolean not null default true,
  payload jsonb not null,
  page_index int not null,
  versao_query_used bigint not null,
  x_total_count_snapshot int,
  x_max_version_snapshot bigint,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

create index if not exists focus_get_sync_nfe_staging_exec_id_idx
  on public.focus_get_sync_nfe_staging (exec_id);

create index if not exists focus_get_sync_nfe_staging_company_created_idx
  on public.focus_get_sync_nfe_staging (company_id, created_at desc);

comment on table public.focus_get_sync_nfe_staging is
  'Notas NF-e recebidas (nfe_completa=true) guardadas pela função focus-get-sync-nfe para validação; expira em 7 dias.';

alter table public.focus_get_sync_nfe_staging enable row level security;

create policy "focus_get_sync_nfe_staging_select_member"
  on public.focus_get_sync_nfe_staging
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_companies uc
      where uc.user_id = auth.uid ()
        and uc.company_id = focus_get_sync_nfe_staging.company_id
    )
  );

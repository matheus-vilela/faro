-- Dia de início da semana contábil da unidade (0=domingo … 6=sábado; padrão=segunda).
alter table public.companies
  add column if not exists accounting_week_starts_on smallint not null default 1
    constraint companies_accounting_week_starts_on_chk
      check (accounting_week_starts_on >= 0 and accounting_week_starts_on <= 6);

comment on column public.companies.accounting_week_starts_on is
  'Dia da semana em que começa a semana contábil (0=domingo … 6=sábado). O fim é sempre 6 dias depois.';

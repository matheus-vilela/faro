-- Serviços EPOC (catálogo + vendas diárias), faturamento diário, formas de pagamento
-- e status por dia (produtos / serviços / faturamento) para retry parcial.

-- ---------------------------------------------------------------------------
-- services (catálogo por unidade; sem estoque)
-- ---------------------------------------------------------------------------
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint services_company_code_uq unique (company_id, code)
);

create index if not exists services_company_idx on public.services (company_id);
create index if not exists services_company_name_idx on public.services (company_id, name);

comment on table public.services is
  'Catálogo de serviços EPOC por unidade (código do portal; sem estoque).';

alter table public.services enable row level security;

create policy "services_select_member"
  on public.services for select to authenticated
  using (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  );

create policy "services_write_member"
  on public.services for all to authenticated
  using (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  )
  with check (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.services to authenticated;
grant select, insert, update, delete on public.services to service_role;

-- ---------------------------------------------------------------------------
-- service_daily_sales
-- ---------------------------------------------------------------------------
create table if not exists public.service_daily_sales (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  service_id uuid not null references public.services (id) on delete cascade,
  sale_date date not null,
  quantity numeric(18, 4) not null default 0,
  unit_price numeric(18, 4) not null default 0,
  gross_value numeric(18, 4) not null default 0,
  discount numeric(18, 4) not null default 0,
  surcharge numeric(18, 4) not null default 0,
  allocation numeric(18, 4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_daily_sales_uq unique (company_id, service_id, sale_date)
);

create index if not exists service_daily_sales_company_date_idx
  on public.service_daily_sales (company_id, sale_date);
create index if not exists service_daily_sales_service_date_idx
  on public.service_daily_sales (service_id, sale_date);

comment on table public.service_daily_sales is
  'Vendas diárias de serviços EPOC (qtde, unitário, bruto, desconto, acréscimo, rateio).';

alter table public.service_daily_sales enable row level security;

create policy "service_daily_sales_select_member"
  on public.service_daily_sales for select to authenticated
  using (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  );

create policy "service_daily_sales_write_member"
  on public.service_daily_sales for all to authenticated
  using (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  )
  with check (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.service_daily_sales to authenticated;
grant select, insert, update, delete on public.service_daily_sales to service_role;

-- ---------------------------------------------------------------------------
-- payment_methods (por estabelecimento; sku = trecho antes de " - ")
-- ---------------------------------------------------------------------------
create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  sku text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_methods_company_sku_uq unique (company_id, sku)
);

create index if not exists payment_methods_company_idx
  on public.payment_methods (company_id);

comment on table public.payment_methods is
  'Formas de pagamento do estabelecimento (sku EPOC + nome amigável).';

alter table public.payment_methods enable row level security;

create policy "payment_methods_select_member"
  on public.payment_methods for select to authenticated
  using (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  );

create policy "payment_methods_write_member"
  on public.payment_methods for all to authenticated
  using (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  )
  with check (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.payment_methods to authenticated;
grant select, insert, update, delete on public.payment_methods to service_role;

-- ---------------------------------------------------------------------------
-- epoc_faturamento_daily
-- ---------------------------------------------------------------------------
create table if not exists public.epoc_faturamento_daily (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  faturamento_date date not null,
  quantity numeric(18, 4),
  produtos numeric(18, 4),
  servicos numeric(18, 4),
  taxas numeric(18, 4),
  total numeric(18, 4),
  ticket_medio numeric(18, 4),
  produtos_servicos_json jsonb not null default '{}'::jsonb,
  fiscal_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint epoc_faturamento_daily_uq unique (company_id, faturamento_date)
);

create index if not exists epoc_faturamento_daily_company_date_idx
  on public.epoc_faturamento_daily (company_id, faturamento_date);

comment on table public.epoc_faturamento_daily is
  'Faturamento diário EPOC (Total Geral tabela_3 + JSON tabela_5 e fiscal).';

alter table public.epoc_faturamento_daily enable row level security;

create policy "epoc_faturamento_daily_select_member"
  on public.epoc_faturamento_daily for select to authenticated
  using (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  );

create policy "epoc_faturamento_daily_write_member"
  on public.epoc_faturamento_daily for all to authenticated
  using (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  )
  with check (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.epoc_faturamento_daily to authenticated;
grant select, insert, update, delete on public.epoc_faturamento_daily to service_role;

-- ---------------------------------------------------------------------------
-- epoc_faturamento_daily_payment_methods
-- ---------------------------------------------------------------------------
create table if not exists public.epoc_faturamento_daily_payment_methods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  faturamento_daily_id uuid not null
    references public.epoc_faturamento_daily (id) on delete cascade,
  payment_method_id uuid not null
    references public.payment_methods (id) on delete restrict,
  faturamento_date date not null,
  operation_count numeric(18, 4),
  amount numeric(18, 4) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint epoc_faturamento_daily_pm_uq
    unique (faturamento_daily_id, payment_method_id)
);

create index if not exists epoc_faturamento_daily_pm_company_date_idx
  on public.epoc_faturamento_daily_payment_methods (company_id, faturamento_date);
create index if not exists epoc_faturamento_daily_pm_method_date_idx
  on public.epoc_faturamento_daily_payment_methods (payment_method_id, faturamento_date);

comment on table public.epoc_faturamento_daily_payment_methods is
  'Valor/operações por forma de pagamento no faturamento do dia (filtro por período).';

alter table public.epoc_faturamento_daily_payment_methods enable row level security;

create policy "epoc_faturamento_daily_pm_select_member"
  on public.epoc_faturamento_daily_payment_methods for select to authenticated
  using (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  );

create policy "epoc_faturamento_daily_pm_write_member"
  on public.epoc_faturamento_daily_payment_methods for all to authenticated
  using (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  )
  with check (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  );

grant select, insert, update, delete
  on public.epoc_faturamento_daily_payment_methods to authenticated;
grant select, insert, update, delete
  on public.epoc_faturamento_daily_payment_methods to service_role;

-- ---------------------------------------------------------------------------
-- epoc_sync_day_status (controle parcial + retry)
-- ---------------------------------------------------------------------------
create table if not exists public.epoc_sync_day_status (
  company_id uuid not null references public.companies (id) on delete cascade,
  sync_date date not null,
  products_ok boolean not null default false,
  services_ok boolean not null default false,
  faturamento_ok boolean not null default false,
  products_error text,
  services_error text,
  faturamento_error text,
  updated_at timestamptz not null default now(),
  primary key (company_id, sync_date)
);

create index if not exists epoc_sync_day_status_gaps_idx
  on public.epoc_sync_day_status (company_id, sync_date)
  where services_ok = false or faturamento_ok = false;

comment on table public.epoc_sync_day_status is
  'Estado da sync EPOC por dia (produtos/serviços/faturamento) para retry parcial.';

alter table public.epoc_sync_day_status enable row level security;

create policy "epoc_sync_day_status_select_member"
  on public.epoc_sync_day_status for select to authenticated
  using (
    company_id in (
      select uc.company_id from public.user_companies uc where uc.user_id = auth.uid()
    )
  );

-- Escrita só via service_role (edges).
grant select on public.epoc_sync_day_status to authenticated;
grant select, insert, update, delete on public.epoc_sync_day_status to service_role;

-- Flag para excluir formas (ex.: reembolso) dos totais de venda líquida e relatórios futuros.
alter table public.payment_methods
  add column if not exists include_in_net_sales boolean not null default true;

comment on column public.payment_methods.include_in_net_sales is
  'Se false, valores desta forma não entram no KPI de vendas líquidas nem em relatórios de receita (ex.: reembolso).';

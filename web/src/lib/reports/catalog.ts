import type { PermissionKey } from "@/lib/permissions";
import { hasAnyPermission, hasPermission } from "@/lib/permissions";
import { lookbackFromFilters } from "./formatters";
import type { ReportDefinition, ReportGroup, ReportId } from "./types";

export const REPORT_GROUP_LABELS: Record<ReportGroup, string> = {
  financeiro: "Financeiro",
  gestao: "Gestão",
  operacao: "Operação",
};

export const REPORT_CATALOG: ReportDefinition[] = [
  {
    id: "payables_open",
    title: "Contas a pagar em aberto",
    description: "Pendentes no período, com filtro de vencidas ou a vencer.",
    group: "financeiro",
    permission: "contas_a_pagar",
    filters: ["period", "openDueBucket", "category", "supplier", "search"],
  },
  {
    id: "payables_overdue",
    title: "Contas a pagar vencidas",
    description: "Pendentes com vencimento anterior a hoje.",
    group: "financeiro",
    permission: "contas_a_pagar",
    filters: ["period", "category", "supplier", "search"],
    defaults: { ...lookbackFromFilters(), openDueBucket: "overdue" },
  },
  {
    id: "payments_made",
    title: "Pagamentos realizados",
    description: "Contas a pagar quitadas no período, pela data de pagamento.",
    group: "financeiro",
    permission: "contas_a_pagar",
    filters: ["period", "category", "supplier", "bankAccount", "search"],
    defaults: { dateField: "paid_at" },
  },
  {
    id: "receivables_open",
    title: "Contas a receber em aberto",
    description: "Recebíveis pendentes no período.",
    group: "financeiro",
    permission: "vendas_realizadas",
    filters: ["period", "openDueBucket", "category", "search"],
  },
  {
    id: "receipts_made",
    title: "Recebimentos realizados",
    description: "Entradas quitadas no período, pela data de recebimento.",
    group: "financeiro",
    permission: "vendas_realizadas",
    filters: ["period", "category", "search"],
    defaults: { dateField: "paid_at" },
  },
  {
    id: "financial_movement",
    title: "Movimentação financeira",
    description: "Entradas e saídas no período, por competência ou caixa.",
    group: "financeiro",
    permission: ["contas_a_pagar", "vendas_realizadas"],
    filters: ["period", "dateField", "flowType", "situation", "category", "search"],
  },
  {
    id: "cash_flow_by_category",
    title: "Fluxo de caixa por categoria",
    description: "Totais de entrada e saída agrupados por categoria.",
    group: "gestao",
    permission: ["contas_a_pagar", "vendas_realizadas"],
    filters: ["period", "basis", "natureza", "category"],
  },
  {
    id: "cash_flow_summary",
    title: "Fluxo de caixa resumido",
    description: "Projeção semanal com KPIs da simulação de caixa.",
    group: "gestao",
    permission: ["contas_a_pagar", "vendas_realizadas"],
    filters: ["scenario"],
  },
  {
    id: "dre",
    title: "DRE",
    description: "Demonstrativo de resultado do mês, por vencimento.",
    group: "gestao",
    permission: "dre",
    filters: ["month", "dreView"],
  },
  {
    id: "dre_uncategorized",
    title: "DRE sem categoria",
    description: "Lançamentos do mês sem categoria DRE.",
    group: "gestao",
    permission: "dre",
    filters: ["month"],
  },
  {
    id: "budget",
    title: "Orçamento vs realizado",
    description: "Meta por categoria comparado ao gasto do mês.",
    group: "gestao",
    permission: "dre",
    filters: ["month", "basis"],
  },
  {
    id: "sales_summary",
    title: "Resumo de vendas",
    description: "Recebíveis do período por categoria e situação.",
    group: "gestao",
    permission: "vendas_realizadas",
    filters: ["period", "category"],
  },
  {
    id: "epoc_billing",
    title: "Faturamento EPOC",
    description: "Totais diários de produtos, serviços e geral.",
    group: "gestao",
    permission: "vendas_realizadas",
    filters: ["period"],
  },
  {
    id: "cmv_margins",
    title: "CMV e margens",
    description: "Custo, markup e margem por produto no período.",
    group: "gestao",
    permission: "vendas_realizadas",
    filters: ["cmvPeriod"],
  },
  {
    id: "suppliers",
    title: "Fornecedores",
    description: "Cadastro de fornecedores e dados de pagamento.",
    group: "operacao",
    permission: "fornecedores",
    filters: ["search"],
  },
  {
    id: "expenses",
    title: "Notas e recebimento",
    description: "Notas fiscais e documentos no período.",
    group: "operacao",
    permission: ["despesas", "recebimento"],
    filters: ["period", "search", "expenseStatus", "expenseOrigin"],
  },
  {
    id: "stock_movements",
    title: "Movimentações de estoque",
    description: "Entradas, saídas e perdas no período.",
    group: "operacao",
    permission: "produtos",
    filters: ["period", "movementDirection"],
  },
  {
    id: "stock_catalog",
    title: "Estoque (catálogo)",
    description: "Produtos, quantidades e custos.",
    group: "operacao",
    permission: "produtos",
    filters: ["stockMode"],
  },
  {
    id: "reconciliation",
    title: "Conciliação bancária",
    description: "Linhas do extrato e situação da conciliação.",
    group: "operacao",
    permission: ["contas_a_pagar", "vendas_realizadas"],
    filters: ["period", "bankAccount", "reconStatus"],
  },
];

export function getReportDefinition(id: ReportId): ReportDefinition {
  const found = REPORT_CATALOG.find((r) => r.id === id);
  if (!found) throw new Error(`Relatório desconhecido: ${id}`);
  return found;
}

export function reportMatchesPermission(
  def: ReportDefinition,
  permissions: readonly string[] | null | undefined,
  isOwner: boolean,
  isAdmin: boolean,
): boolean {
  if (isAdmin || isOwner) return true;
  const keys = Array.isArray(def.permission)
    ? def.permission
    : [def.permission];
  return hasAnyPermission(permissions, keys as PermissionKey[]);
}

export function visibleReports(
  permissions: readonly string[] | null | undefined,
  isOwner: boolean,
  isAdmin: boolean,
): ReportDefinition[] {
  return REPORT_CATALOG.filter((d) =>
    reportMatchesPermission(d, permissions, isOwner, isAdmin),
  );
}

export const REPORTS_PERMISSIONS: PermissionKey[] = [
  "contas_a_pagar",
  "vendas_realizadas",
  "dre",
  "fornecedores",
  "despesas",
  "recebimento",
  "produtos",
];

export function canAccessReports(
  permissions: readonly string[] | null | undefined,
  isOwner: boolean,
  isAdmin: boolean,
): boolean {
  if (isAdmin || isOwner) return true;
  return REPORTS_PERMISSIONS.some((k) => hasPermission(permissions, k));
}

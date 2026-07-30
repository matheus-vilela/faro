import type { DreBucket } from "@/lib/dre/dreMapping";

export type BudgetBasis = "competencia" | "caixa";

export type BudgetDeviationStatus =
  | "ok"
  | "warning"
  | "over"
  | "no_budget"
  | "empty";

export interface CategoryBudgetRow {
  categoryId: string;
  amount: number;
}

export interface BudgetComparisonNode {
  id: string;
  name: string;
  isLeaf: boolean;
  budgeted: number;
  actual: number;
  variance: number;
  percentConsumed: number | null;
  status: BudgetDeviationStatus;
  children: BudgetComparisonNode[];
  dreBucket?: DreBucket;
}

export interface BudgetComparisonSummary {
  totalBudgeted: number;
  totalActual: number;
  totalVariance: number;
  percentConsumed: number | null;
  aggregateStatus: BudgetDeviationStatus;
}

export interface BudgetComparisonResult {
  sections: BudgetComparisonNode[];
  summary: BudgetComparisonSummary;
  /** Folhas com maior desvio absoluto — para o gráfico. */
  chartRows: Array<{
    categoryId: string;
    name: string;
    budgeted: number;
    actual: number;
    variance: number;
  }>;
  leafCategoryIds: Set<string>;
}

export const BUDGET_PREFS_STORAGE_PREFIX = "faro-budget-prefs:";

export const DEFAULT_BUDGET_PREFS = {
  basis: "competencia" as BudgetBasis,
};

export const EXPENSE_BUCKET_SECTIONS: { bucket: DreBucket; label: string }[] = [
  { bucket: "CMV", label: "CMV" },
  { bucket: "DESPESAS_VARIAVEIS", label: "Despesas variáveis" },
  { bucket: "DESPESAS_FIXAS", label: "Despesas fixas" },
  { bucket: "IMPOSTOS", label: "Impostos" },
  {
    bucket: "RESULTADO_FINANCEIRO_DESPESA",
    label: "Resultado financeiro (despesa)",
  },
];

/** Limite máximo por linha de orçamento (R$ 999 mi). */
export const MAX_BUDGET_AMOUNT = 999_999_999.99;

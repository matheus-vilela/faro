import { computeBudgetComparison } from "@/lib/budget/computeBudgetComparison";
import { fetchActualByCategory } from "@/lib/budget/fetchActualByCategory";
import { fetchCategoryBudgets } from "@/lib/budget/fetchCategoryBudgets";
import type { BudgetComparisonNode } from "@/lib/budget/types";
import { supabase } from "@/lib/supabase";
import type { CompanyCategory } from "@/types/category";
import { monthYearLabel } from "../formatters";
import type { ReportResult, ReportRunContext } from "../types";

function flattenBudget(
  nodes: BudgetComparisonNode[],
  depth = 0,
): {
  name: string;
  budgeted: number;
  actual: number;
  variance: number;
  percent: number | null;
  status: string;
}[] {
  const out: ReturnType<typeof flattenBudget> = [];
  for (const n of nodes) {
    out.push({
      name: `${"— ".repeat(depth)}${n.name}`,
      budgeted: n.budgeted,
      actual: n.actual,
      variance: n.variance,
      percent: n.percentConsumed,
      status: n.status,
    });
    out.push(...flattenBudget(n.children, depth + 1));
  }
  return out;
}

const STATUS_LABEL: Record<string, string> = {
  ok: "Ok",
  warning: "Atenção",
  over: "Estourou",
  no_budget: "Sem orçamento",
  empty: "Vazio",
};

export async function buildBudgetReport(
  ctx: ReportRunContext,
): Promise<ReportResult> {
  const { month, year, basis } = ctx.filters;
  const period = { month, year };
  const catRes = await supabase
    .from("company_categories")
    .select("*")
    .eq("company_id", ctx.companyId)
    .order("ordem", { ascending: true });
  if (catRes.error) throw catRes.error;
  const categories = (catRes.data ?? []) as CompanyCategory[];
  const categoriesById = new Map(categories.map((c) => [c.id, c]));
  const [budgets, actualRes] = await Promise.all([
    fetchCategoryBudgets(ctx.companyId, year, month),
    fetchActualByCategory(ctx.companyId, period, basis, categoriesById),
  ]);
  const comparison = computeBudgetComparison({
    categories,
    budgets,
    actualByCategoryId: actualRes.byCategoryId,
    salesCmv: actualRes.salesCmv,
  });
  const rows = flattenBudget(comparison.sections).map((r) => ({
    ...r,
    status: STATUS_LABEL[r.status] ?? r.status,
  }));

  return {
    title: "Orçamento vs realizado",
    slug: "orcamento",
    subtitle: ctx.companyName,
    metaLines: [
      `Empresa: ${ctx.companyName}`,
      `Mês: ${monthYearLabel(month, year)}`,
      `Base: ${basis === "caixa" ? "caixa" : "competência"}`,
    ],
    tables: [
      {
        title: "Resumo",
        columns: [
          { key: "label", header: "Indicador" },
          { key: "value", header: "Valor", format: "money", align: "right" },
        ],
        rows: [
          { label: "Orçado", value: comparison.summary.totalBudgeted },
          { label: "Realizado", value: comparison.summary.totalActual },
          { label: "Desvio", value: comparison.summary.totalVariance },
        ],
      },
      {
        title: "Categorias",
        columns: [
          { key: "name", header: "Categoria" },
          { key: "budgeted", header: "Orçado", format: "money", align: "right" },
          { key: "actual", header: "Realizado", format: "money", align: "right" },
          { key: "variance", header: "Desvio", format: "money", align: "right" },
          { key: "percent", header: "% consumido", format: "number", align: "right" },
          { key: "status", header: "Status" },
        ],
        rows,
      },
    ],
  };
}

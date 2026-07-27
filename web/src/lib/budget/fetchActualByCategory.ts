import type { MonthYear } from "@/components/MonthSelector";
import { getMonthYmdRange } from "@/lib/payableTotals";
import { supabase } from "@/lib/supabase";
import type { CompanyCategory } from "@/types/category";
import { mapCategoryToDreBucket } from "@/lib/dre/dreMapping";
import type { BudgetBasis } from "./types";

export type ActualByCategoryResult = {
  byCategoryId: Map<string, number>;
  /** Payables no período sem company_category_id. */
  semCategoriaCount: number;
  semCategoriaTotal: number;
  /** CMV de vendas (revenue_entries) no mês — competência por entry_date. */
  salesCmv: number;
};

type BoletoRow = {
  amount: number;
  paid_amount: number | null;
  company_category_id: string | null;
  flow_type: string | null;
};

/**
 * Realizado de despesas no período.
 * - Competência: due_date no mês (payable ou flow_type nulo)
 * - Caixa: paid_at no mês, status paid
 * Inclui CMV de vendas (só na base competência) para alinhar com o DRE.
 */
export async function fetchActualByCategory(
  companyId: string,
  period: MonthYear,
  basis: BudgetBasis,
  categoriesById: Map<string, CompanyCategory>,
): Promise<ActualByCategoryResult> {
  const { startYmd, endYmd } = getMonthYmdRange(period.month, period.year);

  let query = supabase
    .from("boletos")
    .select("amount, paid_amount, company_category_id, flow_type")
    .eq("company_id", companyId)
    .or("flow_type.eq.payable,flow_type.is.null");

  if (basis === "competencia") {
    query = query.gte("due_date", startYmd).lte("due_date", endYmd);
  } else {
    query = query
      .eq("status", "paid")
      .gte("paid_at", `${startYmd}T00:00:00`)
      .lte("paid_at", `${endYmd}T23:59:59.999`);
  }

  const salesCmvPromise =
    basis === "competencia"
      ? supabase
          .from("revenue_entries")
          .select("cmv_amount")
          .eq("company_id", companyId)
          .in("entry_mode", ["product_sale", "recipe_sale"])
          .gte("entry_date", startYmd)
          .lte("entry_date", endYmd)
      : Promise.resolve({ data: [] as { cmv_amount: number | null }[], error: null });

  const [bolRes, revRes] = await Promise.all([query, salesCmvPromise]);

  if (bolRes.error) throw bolRes.error;
  if (revRes.error) throw revRes.error;

  const byCategoryId = new Map<string, number>();
  let semCategoriaCount = 0;
  let semCategoriaTotal = 0;

  for (const b of (bolRes.data ?? []) as BoletoRow[]) {
    // Exclui recebíveis explícitos (já filtrados no query, reforço)
    if (b.flow_type === "receivable") continue;

    const amount =
      basis === "caixa"
        ? Number(b.paid_amount ?? b.amount) || 0
        : Number(b.amount) || 0;
    if (!Number.isFinite(amount) || amount === 0) continue;

    if (!b.company_category_id) {
      semCategoriaCount += 1;
      semCategoriaTotal += Math.abs(amount);
      continue;
    }

    const cat = categoriesById.get(b.company_category_id);
    if (!cat || cat.natureza !== "DESPESA") continue;
    const bucket = mapCategoryToDreBucket(cat);
    if (
      bucket === "EXCLUDE" ||
      bucket === "UNMAPPED" ||
      bucket === "VENDAS_BRUTAS" ||
      bucket === "DEDUCAO_RECEITA" ||
      bucket === "RESULTADO_FINANCEIRO_RECEITA"
    ) {
      continue;
    }

    byCategoryId.set(
      b.company_category_id,
      (byCategoryId.get(b.company_category_id) ?? 0) + amount,
    );
  }

  const salesCmv = (revRes.data ?? []).reduce(
    (s, row) => s + Math.max(0, Number(row.cmv_amount) || 0),
    0,
  );

  return {
    byCategoryId,
    semCategoriaCount,
    semCategoriaTotal,
    salesCmv,
  };
}

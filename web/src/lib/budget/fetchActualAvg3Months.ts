import type { MonthYear } from "@/components/MonthSelector";
import { shiftMonth } from "@/lib/dre/dreInsight";
import { getMonthYmdRange } from "@/lib/payableTotals";
import { supabase } from "@/lib/supabase";
import type { CompanyCategory } from "@/types/category";
import { fetchExpenseItemsForRateio } from "@/lib/dre/fetchExpenseItemsForRateio";
import {
  expandBoletoAmountByItemCategories,
  groupRateioItemsByExpenseId,
  omitPurchaseCmvCategoryAmounts,
} from "@/lib/dre/rateioBoletoByItems";
import { isBudgetActualCategory } from "./fetchActualByCategory";
import type { BudgetBasis } from "./types";

/**
 * Média do realizado (payables) por categoria nos 3 meses anteriores ao período.
 * Usa os mesmos filtros do realizado do mês (sem transferências, só DESPESA mapeada).
 */
export async function fetchActualAvg3Months(
  companyId: string,
  period: MonthYear,
  basis: BudgetBasis,
  categoriesById: Map<string, CompanyCategory>,
): Promise<Map<string, number>> {
  const months: MonthYear[] = [
    shiftMonth(period, -1),
    shiftMonth(period, -2),
    shiftMonth(period, -3),
  ];

  const first = months[2];
  const last = months[0];
  const { startYmd } = getMonthYmdRange(first.month, first.year);
  const { endYmd } = getMonthYmdRange(last.month, last.year);

  let query = supabase
    .from("boletos")
    .select(
      "amount, paid_amount, company_category_id, due_date, paid_at, status, flow_type, entry_kind, expense_id",
    )
    .eq("company_id", companyId)
    .or("flow_type.eq.payable,flow_type.is.null")
    .neq("entry_kind", "transfer");

  if (basis === "competencia") {
    query = query.gte("due_date", startYmd).lte("due_date", endYmd);
  } else {
    query = query
      .eq("status", "paid")
      .gte("paid_at", `${startYmd}T00:00:00`)
      .lte("paid_at", `${endYmd}T23:59:59.999`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = data ?? [];
  const items = await fetchExpenseItemsForRateio(
    companyId,
    rows
      .map((row) => row.expense_id as string | null)
      .filter((id): id is string => Boolean(id)),
  );
  const itemsByExpenseId = groupRateioItemsByExpenseId(items);

  const sums = new Map<string, number>();
  const monthKeys = new Set(
    months.map((m) => `${m.year}-${String(m.month).padStart(2, "0")}`),
  );

  for (const row of rows) {
    if (row.flow_type === "receivable") continue;
    if (row.entry_kind === "transfer") continue;

    let ymd: string | null = null;
    if (basis === "competencia") {
      ymd = (row.due_date as string)?.slice(0, 10) ?? null;
    } else {
      ymd = (row.paid_at as string)?.slice(0, 10) ?? null;
    }
    if (!ymd) continue;
    const key = ymd.slice(0, 7);
    if (!monthKeys.has(key)) continue;

    const amount =
      basis === "caixa"
        ? Number(row.paid_amount ?? row.amount) || 0
        : Number(row.amount) || 0;
    if (!Number.isFinite(amount) || amount === 0) continue;

    const expenseId = (row.expense_id as string | null)?.trim() || null;
    const slices = omitPurchaseCmvCategoryAmounts(
      expandBoletoAmountByItemCategories(
        {
          amount,
          expense_id: expenseId,
          company_category_id: (row.company_category_id as string | null) ?? null,
        },
        expenseId ? (itemsByExpenseId.get(expenseId) ?? []) : [],
      ),
      categoriesById,
    );

    for (const slice of slices) {
      const catId = slice.company_category_id;
      if (!catId) continue;
      const cat = categoriesById.get(catId);
      if (!isBudgetActualCategory(cat)) continue;
      sums.set(catId, (sums.get(catId) ?? 0) + slice.amount);
    }
  }

  const avg = new Map<string, number>();
  for (const [id, total] of sums) {
    avg.set(id, total / 3);
  }
  return avg;
}

import { getMonthRange, type MonthYear } from "@/components/MonthSelector";
import { shiftMonth } from "@/lib/dre/dreInsight";
import { supabase } from "@/lib/supabase";
import type { BudgetBasis } from "./types";

/**
 * Média do realizado (payables) por categoria nos 3 meses anteriores ao período.
 */
export async function fetchActualAvg3Months(
  companyId: string,
  period: MonthYear,
  basis: BudgetBasis,
): Promise<Map<string, number>> {
  const months: MonthYear[] = [
    shiftMonth(period, -1),
    shiftMonth(period, -2),
    shiftMonth(period, -3),
  ];

  const first = months[2];
  const last = months[0];
  const { start } = getMonthRange(first.month, first.year);
  const { end } = getMonthRange(last.month, last.year);
  const startDate = start.slice(0, 10);
  const endDate = end.slice(0, 10);

  let query = supabase
    .from("boletos")
    .select("amount, paid_amount, company_category_id, due_date, paid_at, status")
    .eq("company_id", companyId)
    .eq("flow_type", "payable");

  if (basis === "competencia") {
    query = query.gte("due_date", startDate).lte("due_date", endDate);
  } else {
    query = query
      .eq("status", "paid")
      .gte("paid_at", `${startDate}T00:00:00`)
      .lte("paid_at", `${endDate}T23:59:59.999`);
  }

  const { data, error } = await query;
  if (error) throw error;

  const sums = new Map<string, number>();
  const monthKeys = new Set(
    months.map(
      (m) => `${m.year}-${String(m.month).padStart(2, "0")}`,
    ),
  );

  for (const row of data ?? []) {
    const catId = row.company_category_id as string | null;
    if (!catId) continue;

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
    sums.set(catId, (sums.get(catId) ?? 0) + amount);
  }

  const avg = new Map<string, number>();
  for (const [id, total] of sums) {
    avg.set(id, total / 3);
  }
  return avg;
}

import { getMonthRange } from "@/components/MonthSelector";
import type { MonthYear } from "@/components/MonthSelector";
import { aggregateTotalsByCategory } from "@/lib/dre/computeDre";
import { supabase } from "@/lib/supabase";
import type { CompanyCategory } from "@/types/category";
import type { BudgetBasis } from "./types";

type BoletoRow = {
  amount: number;
  paid_amount: number | null;
  company_category_id: string | null;
};

export async function fetchActualByCategory(
  companyId: string,
  period: MonthYear,
  basis: BudgetBasis,
  categoriesById: Map<string, CompanyCategory>,
): Promise<Map<string, number>> {
  const { start, end } = getMonthRange(period.month, period.year);
  const startDate = start.slice(0, 10);
  const endDate = end.slice(0, 10);

  let query = supabase
    .from("boletos")
    .select("amount, paid_amount, company_category_id")
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

  const rows = (data ?? []) as BoletoRow[];
  const totals = aggregateTotalsByCategory(
    rows.map((b) => ({
      amount:
        basis === "caixa"
          ? Number(b.paid_amount ?? b.amount) || 0
          : Number(b.amount) || 0,
      company_category_id: b.company_category_id ?? null,
    })),
    categoriesById,
  );

  return totals.byCategoryId;
}

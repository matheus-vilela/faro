import { supabase } from "@/lib/supabase";
import type { CategoryBudgetRow } from "./types";

export async function fetchCategoryBudgets(
  companyId: string,
  year: number,
  month: number,
): Promise<CategoryBudgetRow[]> {
  const { data, error } = await supabase
    .from("company_category_budgets")
    .select("category_id, amount")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("month", month);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    categoryId: row.category_id as string,
    amount: Number(row.amount) || 0,
  }));
}

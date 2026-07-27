import { supabase } from "@/lib/supabase";
import { MAX_BUDGET_AMOUNT } from "./types";

export function validateBudgetAmount(amount: number): string | null {
  if (!Number.isFinite(amount)) return "Valor inválido.";
  if (amount < 0) return "O orçamento não pode ser negativo.";
  if (amount > MAX_BUDGET_AMOUNT) return "Valor acima do limite permitido.";
  return null;
}

export async function upsertCategoryBudget(input: {
  companyId: string;
  categoryId: string;
  year: number;
  month: number;
  amount: number;
}): Promise<void> {
  const err = validateBudgetAmount(input.amount);
  if (err) throw new Error(err);

  if (input.amount === 0) {
    const { error } = await supabase
      .from("company_category_budgets")
      .delete()
      .eq("company_id", input.companyId)
      .eq("category_id", input.categoryId)
      .eq("year", input.year)
      .eq("month", input.month);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("company_category_budgets").upsert(
    {
      company_id: input.companyId,
      category_id: input.categoryId,
      year: input.year,
      month: input.month,
      amount: input.amount,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id,category_id,year,month" },
  );
  if (error) throw error;
}

export async function copyBudgetsFromPreviousMonth(input: {
  companyId: string;
  year: number;
  month: number;
}): Promise<number> {
  const prevMonth = input.month === 1 ? 12 : input.month - 1;
  const prevYear = input.month === 1 ? input.year - 1 : input.year;

  const { data: source, error: fetchError } = await supabase
    .from("company_category_budgets")
    .select("category_id, amount")
    .eq("company_id", input.companyId)
    .eq("year", prevYear)
    .eq("month", prevMonth);

  if (fetchError) throw fetchError;
  if (!source?.length) return 0;

  const rows = source.map((row) => ({
    company_id: input.companyId,
    category_id: row.category_id,
    year: input.year,
    month: input.month,
    amount: row.amount,
    updated_at: new Date().toISOString(),
  }));

  const { error: upsertError } = await supabase
    .from("company_category_budgets")
    .upsert(rows, { onConflict: "company_id,category_id,year,month" });

  if (upsertError) throw upsertError;
  return rows.length;
}

export async function clearBudgetsForMonth(input: {
  companyId: string;
  year: number;
  month: number;
}): Promise<void> {
  const { error } = await supabase
    .from("company_category_budgets")
    .delete()
    .eq("company_id", input.companyId)
    .eq("year", input.year)
    .eq("month", input.month);
  if (error) throw error;
}

import { supabase } from "@/lib/supabase";
import type { RateioLine } from "@/lib/dre/rateioBoletoByItems";

const IN_CHUNK = 100;

export async function fetchExpenseItemsForRateio(
  companyId: string,
  expenseIds: string[],
): Promise<RateioLine[]> {
  const ids = [...new Set(expenseIds.map((id) => id.trim()).filter(Boolean))];
  if (!companyId || ids.length === 0) return [];

  const rows: RateioLine[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from("expense_items")
      .select("expense_id, quantity, unit_value, company_category_id")
      .eq("company_id", companyId)
      .in("expense_id", chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      const expenseId = String(
        (row as { expense_id?: string }).expense_id ?? "",
      ).trim();
      if (!expenseId) continue;
      rows.push({
        expense_id: expenseId,
        quantity: Number((row as { quantity?: number }).quantity) || 0,
        unit_value: Number((row as { unit_value?: number }).unit_value) || 0,
        company_category_id:
          (row as { company_category_id?: string | null }).company_category_id ??
          null,
      });
    }
  }
  return rows;
}

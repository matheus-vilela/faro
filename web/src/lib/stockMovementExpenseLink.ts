import { supabase } from "@/lib/supabase";

export type StockMovementReferenceRow = {
  reference_type: string | null;
  reference_id: string | null;
};

export function stockMovementExpenseHref(expenseId: string): string {
  return `/app/notas-recebimento?expense=${encodeURIComponent(expenseId)}`;
}

export function isExpenseStockMovementReference(
  referenceType: string | null,
): boolean {
  return referenceType === "expense" || referenceType === "expense_item";
}

/** Resolve `expense_id` para movimentações com origem em despesa. */
export async function resolveExpenseIdsForStockMovements<
  T extends StockMovementReferenceRow,
>(rows: T[]): Promise<(T & { expense_id: string | null })[]> {
  const itemIds: string[] = [];
  for (const r of rows) {
    if (r.reference_type === "expense_item" && r.reference_id) {
      itemIds.push(r.reference_id);
    }
  }

  const expenseByItemId = new Map<string, string>();
  if (itemIds.length > 0) {
    const { data, error } = await supabase
      .from("expense_items")
      .select("id, expense_id")
      .in("id", itemIds);
    if (!error) {
      for (const row of data ?? []) {
        if (row.expense_id) {
          expenseByItemId.set(String(row.id), String(row.expense_id));
        }
      }
    }
  }

  return rows.map((r) => {
    let expense_id: string | null = null;
    if (r.reference_type === "expense" && r.reference_id) {
      expense_id = r.reference_id;
    } else if (r.reference_type === "expense_item" && r.reference_id) {
      expense_id = expenseByItemId.get(r.reference_id) ?? null;
    }
    return { ...r, expense_id };
  });
}

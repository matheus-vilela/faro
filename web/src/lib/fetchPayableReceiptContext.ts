import {
  collectReceiptExpenseIds,
  EMPTY_PAYABLE_RECEIPT_CONTEXT,
  type PayableReceiptContext,
  type PayableReceiptExpense,
} from "@/lib/payableBoletoReceipt";
import { supabase } from "@/lib/supabase";
import type { FluxoBoletoRow } from "@/types/expenseSeries";

export async function fetchPayableReceiptContext(
  boletos: Array<
    Pick<FluxoBoletoRow, "expense_id" | "series_master_expense_id">
  >,
): Promise<PayableReceiptContext> {
  const expenseIds = collectReceiptExpenseIds(boletos);
  if (expenseIds.length === 0) return EMPTY_PAYABLE_RECEIPT_CONTEXT;

  const [expRes, recRes] = await Promise.all([
    supabase.from("expenses").select("id, type").in("id", expenseIds),
    supabase
      .from("recebimentos")
      .select("expense_id, status")
      .in("expense_id", expenseIds),
  ]);

  if (expRes.error) throw expRes.error;
  if (recRes.error) throw recRes.error;

  const expenseById = new Map<string, PayableReceiptExpense>();
  for (const row of expRes.data ?? []) {
    expenseById.set(row.id, {
      id: row.id,
      type: row.type as PayableReceiptExpense["type"],
    });
  }

  const recebimentoByExpenseId = new Map<
    string,
    { status: "pending" | "received" }
  >();
  for (const row of recRes.data ?? []) {
    if (!row.expense_id) continue;
    recebimentoByExpenseId.set(row.expense_id, {
      status: row.status as "pending" | "received",
    });
  }

  return { expenseById, recebimentoByExpenseId };
}

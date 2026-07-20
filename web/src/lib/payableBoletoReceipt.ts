import { isProjectedBoleto } from "@/lib/expenseSeriesProjection";
import type { ExpenseSource, ExpenseType } from "@/types/expense";
import type { FluxoBoletoRow } from "@/types/expenseSeries";

export type PayableReceiptExpense = {
  id: string;
  type: ExpenseType;
  expense_source?: ExpenseSource | null;
};

export type PayableReceiptContext = {
  expenseById: Map<string, PayableReceiptExpense>;
  recebimentoByExpenseId: Map<string, { status: "pending" | "received" }>;
};

export const EMPTY_PAYABLE_RECEIPT_CONTEXT: PayableReceiptContext = {
  expenseById: new Map(),
  recebimentoByExpenseId: new Map(),
};

export function isMerchandiseExpenseType(
  type: string | undefined | null,
): boolean {
  return type === "nota_fiscal" || type === "romaneio";
}

export function resolveReceiptExpenseId(
  b: Pick<FluxoBoletoRow, "expense_id" | "series_master_expense_id">,
): string | null {
  return b.expense_id ?? b.series_master_expense_id ?? null;
}

export function isScheduledPayableBoleto(
  b: Pick<FluxoBoletoRow, "status" | "is_projected">,
): boolean {
  if (isProjectedBoleto(b)) return true;
  return b.status === "pending";
}

export function isBoletoReadyToPay(
  b: Pick<
    FluxoBoletoRow,
    "expense_id" | "series_master_expense_id" | "status" | "is_projected"
  >,
  ctx: PayableReceiptContext,
): boolean {
  if (!isScheduledPayableBoleto(b)) return false;

  const expenseId = resolveReceiptExpenseId(b);
  if (!expenseId) return true;

  const expense = ctx.expenseById.get(expenseId);
  if (!expense || !isMerchandiseExpenseType(expense.type)) return true;

  const recebimento = ctx.recebimentoByExpenseId.get(expenseId);
  return recebimento?.status === "received";
}

export function isBoletoPendingMerchandiseReceipt(
  b: Pick<
    FluxoBoletoRow,
    "expense_id" | "series_master_expense_id" | "status" | "is_projected"
  >,
  ctx: PayableReceiptContext,
): boolean {
  if (!isScheduledPayableBoleto(b)) return false;
  return !isBoletoReadyToPay(b, ctx);
}

export function sumPayableBuckets(
  boletos: FluxoBoletoRow[],
  ctx: PayableReceiptContext,
): { readyToPay: number; pendingReceipt: number } {
  let readyToPay = 0;
  let pendingReceipt = 0;

  for (const b of boletos) {
    if (!isScheduledPayableBoleto(b)) continue;
    if (isBoletoReadyToPay(b, ctx)) readyToPay += b.amount;
    else pendingReceipt += b.amount;
  }

  return { readyToPay, pendingReceipt };
}

export function collectReceiptExpenseIds(
  boletos: Array<
    Pick<FluxoBoletoRow, "expense_id" | "series_master_expense_id">
  >,
): string[] {
  const ids = new Set<string>();
  for (const b of boletos) {
    const expenseId = resolveReceiptExpenseId(b);
    if (expenseId) ids.add(expenseId);
  }
  return [...ids];
}

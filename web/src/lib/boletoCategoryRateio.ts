import { allocateByWeights } from "@/lib/dre/rateioBoletoByItems";
import { roundMoney } from "@/lib/boletoPayment";
import { companyCategoryDisplayName } from "@/lib/companyCategoryLabels";
import { supabase } from "@/lib/supabase";
import type { CompanyCategory } from "@/types/category";
import type { ExpenseItem, ExpenseType } from "@/types/expense";
import type { ExpenseSeriesType, RecurrenceFrequency } from "@/types/expenseSeries";

export type RateioDraftLine = {
  key: string;
  categoryId: string;
  amount: number;
};

export function newRateioLineKey(): string {
  return crypto.randomUUID();
}

export function emptyRateioLine(
  categoryId = "",
  amount = 0,
): RateioDraftLine {
  return { key: newRateioLineKey(), categoryId, amount: roundMoney(amount) };
}

export function initialRateioLines(categoryId: string): RateioDraftLine[] {
  return [emptyRateioLine(categoryId, 0), emptyRateioLine("", 0)];
}

export type PayableProductDraftLine = {
  key: string;
  productId: string;
  productName: string;
  quantity: number;
  unitValue: number;
};

export function emptyPayableProductLine(
  unitValue = 0,
): PayableProductDraftLine {
  return {
    key: newRateioLineKey(),
    productId: "",
    productName: "",
    quantity: 1,
    unitValue: roundMoney(unitValue),
  };
}

export function filledPayableProductLines(
  lines: PayableProductDraftLine[],
): PayableProductDraftLine[] {
  return lines.filter(
    (line) =>
      Boolean(line.productId.trim()) &&
      line.quantity > 0 &&
      Number.isFinite(line.unitValue),
  );
}

export function validatePayableProductDraft(
  lines: PayableProductDraftLine[],
): { ok: true } | { ok: false; message: string } {
  if (filledPayableProductLines(lines).length === 0) {
    return {
      ok: false,
      message: "Vincule pelo menos um produto ou desligue a opção.",
    };
  }
  if (lines.some((line) => line.productId.trim() && !(line.quantity > 0))) {
    return { ok: false, message: "Informe a quantidade de cada produto." };
  }
  return { ok: true };
}

export async function insertExpenseItemsForProducts(input: {
  companyId: string;
  expenseId: string;
  lines: PayableProductDraftLine[];
  companyCategoryId: string | null;
}): Promise<void> {
  const rows = filledPayableProductLines(input.lines).map((line) => ({
    company_id: input.companyId,
    expense_id: input.expenseId,
    product_name: line.productName.trim() || "Produto",
    quantity: line.quantity,
    unit_value: roundMoney(line.unitValue),
    product_id: line.productId,
    stock_added: false,
    company_category_id: input.companyCategoryId,
  }));
  if (rows.length === 0) return;
  const { error } = await supabase.from("expense_items").insert(rows);
  if (error) throw error;
}

export function sumRateioAmounts(lines: RateioDraftLine[]): number {
  return roundMoney(
    lines.reduce((s, line) => s + (Number.isFinite(line.amount) ? line.amount : 0), 0),
  );
}

export function remainingToRateio(
  lines: RateioDraftLine[],
  total: number,
): number {
  return roundMoney(roundMoney(total) - sumRateioAmounts(lines));
}

export function percentOfTotal(amount: number, total: number): number {
  const t = roundMoney(total);
  if (t <= 0) return 0;
  return roundMoney((roundMoney(amount) / t) * 100);
}

export function amountFromPercent(percent: number, total: number): number {
  const t = roundMoney(total);
  if (t <= 0) return 0;
  return roundMoney((t * (Number.isFinite(percent) ? percent : 0)) / 100);
}

export function scaleRateioLines(
  lines: RateioDraftLine[],
  newTotal: number,
): RateioDraftLine[] {
  const total = roundMoney(newTotal);
  if (lines.length === 0) return lines;
  const weights = lines.map((line) =>
    Number.isFinite(line.amount) && line.amount > 0 ? line.amount : 0,
  );
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (weightSum <= 0) return lines;
  const amounts = allocateByWeights(total, weights);
  return lines.map((line, i) => ({
    ...line,
    amount: amounts[i] ?? 0,
  }));
}

export function primaryCategoryIdFromRateio(
  lines: RateioDraftLine[],
): string | null {
  const ranked = lines
    .map((line, index) => ({
      categoryId: line.categoryId.trim(),
      amount: roundMoney(line.amount),
      index,
    }))
    .filter((row) => row.categoryId && row.amount > 0)
    .sort(
      (a, b) =>
        b.amount - a.amount || a.index - b.index,
    );
  return ranked[0]?.categoryId ?? null;
}

export type RateioValidation =
  | { ok: true }
  | { ok: false; message: string };

export function validateRateioDraft(
  lines: RateioDraftLine[],
  total: number,
): RateioValidation {
  const filled = lines.filter((line) => line.categoryId.trim() !== "");
  if (filled.length < 2) {
    return { ok: false, message: "Informe pelo menos duas categorias no rateio." };
  }
  const ids = filled.map((line) => line.categoryId.trim());
  if (new Set(ids).size !== ids.length) {
    return { ok: false, message: "Cada categoria só pode aparecer uma vez no rateio." };
  }
  if (filled.some((line) => !(line.amount > 0))) {
    return { ok: false, message: "Cada categoria do rateio precisa de um valor maior que zero." };
  }
  if (filled.length !== lines.length) {
    return { ok: false, message: "Escolha a categoria de todas as linhas do rateio." };
  }
  if (remainingToRateio(lines, total) !== 0) {
    return { ok: false, message: "O restante a ratear precisa zerar para salvar." };
  }
  return { ok: true };
}

export function isMerchandiseExpenseForRateio(
  expenseType: ExpenseType | string | null | undefined,
  items: Array<Pick<ExpenseItem, "product_id">>,
): boolean {
  if (expenseType === "nota_fiscal" || expenseType === "romaneio") return true;
  return items.some((item) => Boolean(item.product_id));
}

export function isCategoryRateioStubItems(
  items: Array<Pick<ExpenseItem, "product_id" | "company_category_id">>,
): boolean {
  if (items.length < 2) return false;
  return items.every(
    (item) => !item.product_id && Boolean(item.company_category_id?.trim()),
  );
}

export function draftLinesFromExpenseItems(
  items: Array<
    Pick<ExpenseItem, "company_category_id" | "quantity" | "unit_value">
  >,
): RateioDraftLine[] {
  return items
    .filter((item) => item.company_category_id?.trim())
    .map((item) =>
      emptyRateioLine(
        item.company_category_id!.trim(),
        Number(item.quantity) * Number(item.unit_value),
      ),
    );
}

export function categoryNameForRateio(
  categoryId: string,
  categories: CompanyCategory[],
): string {
  const cat = categories.find((c) => c.id === categoryId);
  return cat ? companyCategoryDisplayName(cat) : "Categoria";
}

export async function replaceExpenseItemsForRateio(input: {
  companyId: string;
  expenseId: string;
  lines: RateioDraftLine[] | null;
  categories: CompanyCategory[];
  stubProductName: string;
  stubUnitValue: number;
}): Promise<void> {
  const { data: existing, error: existErr } = await supabase
    .from("expense_items")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("expense_id", input.expenseId);
  if (existErr) throw existErr;
  const oldIds = ((existing ?? []) as Array<{ id: string }>).map((row) => row.id);

  const rows =
    input.lines && input.lines.length > 0
      ? input.lines.map((line) => ({
          company_id: input.companyId,
          expense_id: input.expenseId,
          product_name: categoryNameForRateio(line.categoryId, input.categories),
          quantity: 1,
          unit_value: roundMoney(line.amount),
          stock_added: false,
          company_category_id: line.categoryId.trim() || null,
        }))
      : [
          {
            company_id: input.companyId,
            expense_id: input.expenseId,
            product_name: input.stubProductName,
            quantity: 1,
            unit_value: roundMoney(input.stubUnitValue),
            stock_added: false,
            company_category_id: null,
          },
        ];

  const { error: insErr } = await supabase.from("expense_items").insert(rows);
  if (insErr) throw insErr;

  if (oldIds.length > 0) {
    const { error: delErr } = await supabase
      .from("expense_items")
      .delete()
      .eq("company_id", input.companyId)
      .eq("expense_id", input.expenseId)
      .in("id", oldIds);
    if (delErr) throw delErr;
  }
}

export async function createReciboExpense(input: {
  companyId: string;
  userId: string | null;
  description: string;
  dueDate: string;
  amount: number;
  supplierId: string | null;
  supplierName: string | null;
  supplierDocument: string | null;
  seriesType: ExpenseSeriesType;
  recurrenceFrequency?: RecurrenceFrequency | null;
  installmentCount?: number | null;
}): Promise<string> {
  const { data, error } = await supabase
    .from("expenses")
    .insert({
      company_id: input.companyId,
      created_by: input.userId,
      type: "recibo",
      display_name: input.description,
      status: "approved",
      expense_source: "manual",
      reference_date: input.dueDate,
      document_total: roundMoney(input.amount),
      series_type: input.seriesType,
      recurrence_frequency:
        input.seriesType === "recurring"
          ? (input.recurrenceFrequency ?? null)
          : null,
      installment_count:
        input.seriesType === "installment" ? input.installmentCount ?? null : null,
      recurrence_status: input.seriesType === "recurring" ? "active" : null,
      series_anchor_due_date: input.dueDate,
      supplier_id: input.supplierId,
      supplier_name: input.supplierName,
      supplier_document: input.supplierDocument,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function copyExpenseItemsReweighted(input: {
  companyId: string;
  fromExpenseId: string;
  toExpenseId: string;
  toAmount: number;
  fallbackProductName: string;
}): Promise<void> {
  const { data, error } = await supabase
    .from("expense_items")
    .select("product_name, quantity, unit_value, company_category_id, product_id")
    .eq("company_id", input.companyId)
    .eq("expense_id", input.fromExpenseId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const source = (data ?? []) as Array<{
    product_name: string;
    quantity: number;
    unit_value: number;
    company_category_id: string | null;
    product_id: string | null;
  }>;

  const productLines = source.filter((row) => Boolean(row.product_id));
  if (productLines.length > 0) {
    const { error: insErr } = await supabase.from("expense_items").insert(
      productLines.map((row) => ({
        company_id: input.companyId,
        expense_id: input.toExpenseId,
        product_name: row.product_name,
        quantity: Number(row.quantity) || 1,
        unit_value: roundMoney(Number(row.unit_value)),
        product_id: row.product_id,
        stock_added: false,
        company_category_id: row.company_category_id,
      })),
    );
    if (insErr) throw insErr;
    return;
  }

  const classified = source.filter(
    (row) => !row.product_id && Boolean(row.company_category_id?.trim()),
  );
  const weights = classified.map(
    (row) => Number(row.quantity) * Number(row.unit_value),
  );
  const weightSum = weights.reduce((s, w) => s + (w > 0 ? w : 0), 0);

  if (classified.length >= 2 && weightSum > 0) {
    const amounts = allocateByWeights(roundMoney(input.toAmount), weights);
    const { error: insErr } = await supabase.from("expense_items").insert(
      classified.map((row, i) => ({
        company_id: input.companyId,
        expense_id: input.toExpenseId,
        product_name: row.product_name,
        quantity: 1,
        unit_value: amounts[i] ?? 0,
        stock_added: false,
        company_category_id: row.company_category_id,
      })),
    );
    if (insErr) throw insErr;
    return;
  }

  const { error: stubErr } = await supabase.from("expense_items").insert({
    company_id: input.companyId,
    expense_id: input.toExpenseId,
    product_name: input.fallbackProductName,
    quantity: 1,
    unit_value: roundMoney(input.toAmount),
    stock_added: false,
  });
  if (stubErr) throw stubErr;
}

export async function reweightExpenseRateioItems(input: {
  companyId: string;
  expenseId: string;
  toAmount: number;
}): Promise<void> {
  const { data, error } = await supabase
    .from("expense_items")
    .select("id, quantity, unit_value, company_category_id, product_id")
    .eq("company_id", input.companyId)
    .eq("expense_id", input.expenseId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    id: string;
    quantity: number;
    unit_value: number;
    company_category_id: string | null;
    product_id: string | null;
  }>;
  const classified = rows.filter(
    (row) => !row.product_id && Boolean(row.company_category_id?.trim()),
  );
  if (classified.length < 2) return;
  const weights = classified.map(
    (row) => Number(row.quantity) * Number(row.unit_value),
  );
  const amounts = allocateByWeights(roundMoney(input.toAmount), weights);
  for (let i = 0; i < classified.length; i++) {
    const row = classified[i]!;
    const { error: updErr } = await supabase
      .from("expense_items")
      .update({ quantity: 1, unit_value: amounts[i] ?? 0 })
      .eq("id", row.id)
      .eq("company_id", input.companyId);
    if (updErr) throw updErr;
  }
}

export async function clearReciboStubItemCategories(input: {
  companyId: string;
  expenseIds: string[];
}): Promise<void> {
  const ids = [...new Set(input.expenseIds.filter(Boolean))];
  if (ids.length === 0) return;

  const { data: expenses, error: expErr } = await supabase
    .from("expenses")
    .select("id, type")
    .eq("company_id", input.companyId)
    .in("id", ids);
  if (expErr) throw expErr;

  const reciboIds = ((expenses ?? []) as Array<{ id: string; type: string }>)
    .filter((row) => row.type === "recibo")
    .map((row) => row.id);
  if (reciboIds.length === 0) return;

  const { error } = await supabase
    .from("expense_items")
    .update({ company_category_id: null })
    .eq("company_id", input.companyId)
    .in("expense_id", reciboIds)
    .is("product_id", null);
  if (error) throw error;
}

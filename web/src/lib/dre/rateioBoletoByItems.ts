import { mapCategoryToDreBucket } from "@/lib/dre/dreMapping";
import type { CompanyCategory } from "@/types/category";

/** Linha da nota usada para ratear o valor da conta. */
export type RateioLine = {
  expense_id: string;
  quantity: number;
  unit_value: number;
  company_category_id?: string | null;
};

export type RateioBoleto = {
  amount: number;
  expense_id?: string | null;
  company_category_id?: string | null;
};

export type CategoryAmount = {
  amount: number;
  company_category_id: string | null;
};

export const MIXED_ITEM_CATEGORY_KEY = "varias-categorias";
export const MIXED_ITEM_CATEGORY_LABEL = "Várias categorias";

export function lineSubtotal(quantity: number, unitValue: number): number {
  const q = Number(quantity);
  const v = Number(unitValue);
  if (!Number.isFinite(q) || !Number.isFinite(v)) return 0;
  const s = q * v;
  return Number.isFinite(s) && s > 0 ? s : 0;
}

/**
 * Prefill da linha: categoria já gravada, senão último padrão de compra,
 * senão CMV do cadastro (Alimentos/Bebidas).
 */
export function resolvePrefillCompanyCategoryId(args: {
  itemCategoryId?: string | null;
  productDefaultCategoryId?: string | null;
  productCmvCategoryId?: string | null;
}): string | null {
  const item = args.itemCategoryId?.trim() || null;
  if (item) return item;
  const def = args.productDefaultCategoryId?.trim() || null;
  if (def) return def;
  return args.productCmvCategoryId?.trim() || null;
}

/**
 * Compra classificada em CMV (Alimentos etc.) não entra no P&L:
 * o CMV da DRE continua vindo das vendas. Limpeza e demais naturezas seguem no rateio.
 */
export function omitPurchaseCmvCategoryAmounts(
  rows: CategoryAmount[],
  categoriesById: Map<string, CompanyCategory>,
): CategoryAmount[] {
  return rows.filter((row) => {
    const id = row.company_category_id?.trim();
    if (!id) return true;
    const cat = categoriesById.get(id);
    if (!cat) return true;
    return mapCategoryToDreBucket(cat) !== "CMV";
  });
}

export function distinctItemCategoryIds(items: RateioLine[]): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    const id = item.company_category_id?.trim();
    if (id) ids.add(id);
  }
  return [...ids];
}

export function boletoHasMultipleItemCategories(items: RateioLine[]): boolean {
  return distinctItemCategoryIds(items).length > 1;
}

/**
 * Reparte `total` (reais) proporcionalmente a `weights`.
 * A soma dos retornos iguala o total (ajuste de centavos no maior resto).
 */
export function allocateByWeights(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(Number(total));
  if (!Number.isFinite(abs) || abs === 0) {
    return weights.map(() => 0);
  }
  const weightSum = weights.reduce(
    (s, w) => s + (Number.isFinite(w) && w > 0 ? w : 0),
    0,
  );
  if (weightSum <= 0) return weights.map(() => 0);

  const cents = Math.round(abs * 100);
  const raw = weights.map((w) => {
    const ww = Number.isFinite(w) && w > 0 ? w : 0;
    return (ww / weightSum) * cents;
  });
  const floors = raw.map((r) => Math.floor(r + 1e-9));
  let remainder = cents - floors.reduce((s, n) => s + n, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - floors[i]! }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...floors];
  let k = 0;
  while (remainder > 0 && order.length > 0) {
    out[order[k % order.length]!.i] += 1;
    remainder -= 1;
    k += 1;
  }
  return out.map((c) => (c / 100) * sign);
}

/**
 * Expande o valor do boleto em fatias por categoria das linhas da nota.
 *
 * - Sem nota / sem itens com subtotal: usa a categoria da conta.
 * - Linha sem categoria: herda a categoria da conta (ou fica sem categoria).
 * - Linhas classificadas: a categoria da conta é ignorada nessas fatias.
 */
export function expandBoletoAmountByItemCategories(
  boleto: RateioBoleto,
  itemsForExpense: RateioLine[],
): CategoryAmount[] {
  const amount = Number(boleto.amount);
  if (!Number.isFinite(amount) || amount === 0) return [];

  const expenseId = boleto.expense_id?.trim() || null;
  const fallback = boleto.company_category_id?.trim() || null;

  if (!expenseId) {
    return [{ amount, company_category_id: fallback }];
  }

  const lines = itemsForExpense.filter(
    (i) => (i.expense_id?.trim() || "") === expenseId,
  );

  const weighted: { categoryId: string | null; subtotal: number }[] = [];
  for (const item of lines) {
    const subtotal = lineSubtotal(item.quantity, item.unit_value);
    if (subtotal <= 0) continue;
    const categoryId = item.company_category_id?.trim() || fallback;
    weighted.push({ categoryId, subtotal });
  }

  if (weighted.length === 0) {
    return [{ amount, company_category_id: fallback }];
  }

  const byCat = new Map<string, number>();
  const keyOf = (id: string | null) => id ?? "";
  for (const row of weighted) {
    const k = keyOf(row.categoryId);
    byCat.set(k, (byCat.get(k) ?? 0) + row.subtotal);
  }

  const keys = [...byCat.keys()];
  const weights = keys.map((k) => byCat.get(k) ?? 0);
  const amounts = allocateByWeights(amount, weights);

  return keys.map((k, i) => ({
    company_category_id: k === "" ? null : k,
    amount: amounts[i] ?? 0,
  }));
}

export function groupRateioItemsByExpenseId(
  items: RateioLine[],
): Map<string, RateioLine[]> {
  const map = new Map<string, RateioLine[]>();
  for (const item of items) {
    const id = item.expense_id?.trim();
    if (!id) continue;
    const list = map.get(id);
    if (list) list.push(item);
    else map.set(id, [item]);
  }
  return map;
}

export function expandBoletosToCategoryAmounts(
  boletos: RateioBoleto[],
  itemsByExpenseId: Map<string, RateioLine[]>,
): CategoryAmount[] {
  const out: CategoryAmount[] = [];
  for (const boleto of boletos) {
    const expenseId = boleto.expense_id?.trim() || "";
    const items = expenseId ? (itemsByExpenseId.get(expenseId) ?? []) : [];
    out.push(...expandBoletoAmountByItemCategories(boleto, items));
  }
  return out;
}

/** Rateio da compra para P&L: fatias CMV (estoque) ficam de fora. */
export function expandBoletosToDrePurchaseAmounts(
  boletos: RateioBoleto[],
  itemsByExpenseId: Map<string, RateioLine[]>,
  categoriesById: Map<string, CompanyCategory>,
): CategoryAmount[] {
  return omitPurchaseCmvCategoryAmounts(
    expandBoletosToCategoryAmounts(boletos, itemsByExpenseId),
    categoriesById,
  );
}

export function boletoHasUnclassifiedRemainder(
  boleto: RateioBoleto,
  itemsForExpense: RateioLine[],
): boolean {
  return expandBoletoAmountByItemCategories(boleto, itemsForExpense).some(
    (row) => row.company_category_id == null && row.amount !== 0,
  );
}

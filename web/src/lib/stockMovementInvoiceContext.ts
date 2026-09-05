import { NFE_PRODUCT_CREATE_REFERENCE_TYPES } from "@/lib/productSuppliers";
import { isExpenseStockMovementReference } from "@/lib/stockMovementExpenseLink";
import { supabase } from "@/lib/supabase";

export type StockMovementInvoiceContext = {
  expenseId: string | null;
  invoiceNumber: string | null;
  invoiceSeries: string | null;
  supplierName: string | null;
  supplierDocument: string | null;
  originalItemName: string | null;
  invoiceQuantity: number | null;
  invoiceUnit: string | null;
};

type ExpenseLite = {
  id: string;
  invoice_number: string | null;
  invoice_series: string | null;
  supplier_name: string | null;
  supplier_document: string | null;
  supplier_id: string | null;
  created_at: string;
  suppliers:
    | { id: string; name: string; document: string | null }
    | { id: string; name: string; document: string | null }[]
    | null;
};

type ExpenseItemLite = {
  id: string;
  expense_id: string;
  product_id: string | null;
  product_name: string | null;
  quantity: number | null;
  invoice_unit: string | null;
  unit_value: number | null;
  created_at: string;
  expenses: ExpenseLite | ExpenseLite[] | null;
};

export function formatInvoiceLabel(
  invoiceNumber: string | null,
  invoiceSeries: string | null,
): string | null {
  const number = invoiceNumber?.trim();
  if (!number) return null;
  const series = invoiceSeries?.trim();
  return series ? `NF ${number} · série ${series}` : `NF ${number}`;
}

export function isNfeProductCreateReference(
  referenceType: string | null,
): boolean {
  const ref = (referenceType ?? "").trim().toLowerCase();
  return (NFE_PRODUCT_CREATE_REFERENCE_TYPES as readonly string[]).includes(
    ref,
  );
}

function firstJoin<T>(raw: T | T[] | null | undefined): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function supplierFromExpense(exp: ExpenseLite): {
  name: string | null;
  document: string | null;
} {
  const linked = firstJoin(exp.suppliers);
  return {
    name: (linked?.name ?? exp.supplier_name ?? "").trim() || null,
    document: linked?.document ?? exp.supplier_document ?? null,
  };
}

export function contextFromExpenseItem(
  item: ExpenseItemLite,
): StockMovementInvoiceContext {
  const exp = firstJoin(item.expenses);
  const supplier = exp
    ? supplierFromExpense(exp)
    : { name: null, document: null };
  const qty =
    item.quantity != null && Number.isFinite(Number(item.quantity))
      ? Number(item.quantity)
      : null;
  return {
    expenseId: exp?.id ?? item.expense_id ?? null,
    invoiceNumber: exp?.invoice_number ?? null,
    invoiceSeries: exp?.invoice_series ?? null,
    supplierName: supplier.name,
    supplierDocument: supplier.document,
    originalItemName: item.product_name?.trim() || null,
    invoiceQuantity: qty,
    invoiceUnit: item.invoice_unit?.trim() || null,
  };
}

export function pickClosestExpenseItem<
  T extends { created_at: string; unit_value: number | null },
>(items: T[], movementAt: string, unitCost: number | null): T | null {
  if (items.length === 0) return null;
  const target = new Date(movementAt).getTime();
  const cost =
    unitCost != null && Number.isFinite(unitCost) ? Number(unitCost) : null;

  return [...items].sort((a, b) => {
    const da = Math.abs(new Date(a.created_at).getTime() - target);
    const db = Math.abs(new Date(b.created_at).getTime() - target);
    if (cost != null) {
      const va = a.unit_value != null ? Math.abs(Number(a.unit_value) - cost) : Infinity;
      const vb = b.unit_value != null ? Math.abs(Number(b.unit_value) - cost) : Infinity;
      if (va !== vb) return va - vb;
    }
    return da - db;
  })[0]!;
}

function hasUsefulContext(ctx: StockMovementInvoiceContext): boolean {
  return Boolean(
    ctx.expenseId ||
      ctx.invoiceNumber ||
      ctx.supplierName ||
      ctx.originalItemName,
  );
}

async function loadExpenseItemById(
  itemId: string,
): Promise<StockMovementInvoiceContext | null> {
  const { data, error } = await supabase
    .from("expense_items")
    .select(
      `
      id, expense_id, product_id, product_name, quantity, invoice_unit, unit_value, created_at,
      expenses (
        id, invoice_number, invoice_series, supplier_name, supplier_document, supplier_id, created_at,
        suppliers ( id, name, document )
      )
    `,
    )
    .eq("id", itemId)
    .maybeSingle();
  if (error || !data) return null;
  return contextFromExpenseItem(data as ExpenseItemLite);
}

async function loadExpenseById(
  expenseId: string,
  productId: string,
): Promise<StockMovementInvoiceContext | null> {
  const { data: expense, error } = await supabase
    .from("expenses")
    .select(
      `
      id, invoice_number, invoice_series, supplier_name, supplier_document, supplier_id, created_at,
      suppliers ( id, name, document )
    `,
    )
    .eq("id", expenseId)
    .maybeSingle();
  if (error || !expense) return null;

  const { data: items } = await supabase
    .from("expense_items")
    .select(
      "id, expense_id, product_id, product_name, quantity, invoice_unit, unit_value, created_at",
    )
    .eq("expense_id", expenseId)
    .eq("product_id", productId)
    .limit(20);

  const item = (items ?? [])[0] as ExpenseItemLite | undefined;
  return contextFromExpenseItem({
    id: item?.id ?? "",
    expense_id: expenseId,
    product_id: item?.product_id ?? productId,
    product_name: item?.product_name ?? null,
    quantity: item?.quantity ?? null,
    invoice_unit: item?.invoice_unit ?? null,
    unit_value: item?.unit_value ?? null,
    created_at: item?.created_at ?? expense.created_at,
    expenses: expense as ExpenseLite,
  });
}

async function loadContextByProduct(
  productId: string,
  movementAt: string,
  unitCost: number | null,
): Promise<StockMovementInvoiceContext | null> {
  const { data, error } = await supabase
    .from("expense_items")
    .select(
      `
      id, expense_id, product_id, product_name, quantity, invoice_unit, unit_value, created_at,
      expenses!inner (
        id, invoice_number, invoice_series, supplier_name, supplier_document, supplier_id, created_at,
        suppliers ( id, name, document )
      )
    `,
    )
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error || !data?.length) return null;
  const picked = pickClosestExpenseItem(
    data as ExpenseItemLite[],
    movementAt,
    unitCost,
  );
  return picked ? contextFromExpenseItem(picked) : null;
}

async function loadSupplierOnly(
  supplierId: string,
): Promise<StockMovementInvoiceContext | null> {
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name, document")
    .eq("id", supplierId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    expenseId: null,
    invoiceNumber: null,
    invoiceSeries: null,
    supplierName: (data.name ?? "").trim() || null,
    supplierDocument: data.document ?? null,
    originalItemName: null,
    invoiceQuantity: null,
    invoiceUnit: null,
  };
}

async function loadSupplierFromProductCodes(
  companyId: string,
  productId: string,
): Promise<StockMovementInvoiceContext | null> {
  const { data, error } = await supabase
    .from("product_supplier_codes")
    .select("supplier_id, created_at, suppliers ( id, name, document )")
    .eq("company_id", companyId)
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const linked = firstJoin(
    data.suppliers as
      | { id: string; name: string; document: string | null }
      | { id: string; name: string; document: string | null }[]
      | null,
  );
  const name = (linked?.name ?? "").trim() || null;
  if (!name && !data.supplier_id) return null;
  return {
    expenseId: null,
    invoiceNumber: null,
    invoiceSeries: null,
    supplierName: name,
    supplierDocument: linked?.document ?? null,
    originalItemName: null,
    invoiceQuantity: null,
    invoiceUnit: null,
  };
}

export async function fetchStockMovementInvoiceContext(input: {
  companyId: string;
  productId: string;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
  unitCost: number | null;
}): Promise<StockMovementInvoiceContext | null> {
  const ref = (input.referenceType ?? "").trim().toLowerCase();
  const refId = input.referenceId?.trim() || null;

  if (isExpenseStockMovementReference(ref) && refId) {
    if (ref === "expense") {
      const ctx = await loadExpenseById(refId, input.productId);
      if (ctx && hasUsefulContext(ctx)) return ctx;
    } else {
      const ctx = await loadExpenseItemById(refId);
      if (ctx && hasUsefulContext(ctx)) return ctx;
    }
  }

  if (isNfeProductCreateReference(ref) || isExpenseStockMovementReference(ref)) {
    const byProduct = await loadContextByProduct(
      input.productId,
      input.createdAt,
      input.unitCost,
    );
    if (byProduct && hasUsefulContext(byProduct)) return byProduct;
  }

  if (isNfeProductCreateReference(ref) && refId) {
    const fromRef = await loadSupplierOnly(refId);
    if (fromRef && hasUsefulContext(fromRef)) return fromRef;
  }

  if (isNfeProductCreateReference(ref)) {
    const fromCodes = await loadSupplierFromProductCodes(
      input.companyId,
      input.productId,
    );
    if (fromCodes && hasUsefulContext(fromCodes)) return fromCodes;
  }

  return null;
}

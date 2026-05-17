import { enrichExtractedWithTaxId } from "../expenseSupplierEnsure.ts";
import type { ExtractedDocumentResult, ExtractedExpenseItem } from "../openaiExpense.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

function parseLooseNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const raw = String(v ?? "").trim();
  if (!raw) return 0;
  const normalized = raw
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Normaliza itens antes de `resolveProductMatches`.
 */
export function normalizeExtractedItemsLikeBatch(
  data: ExtractedDocumentResult,
): ExtractedExpenseItem[] {
  const safeItems = Array.isArray(data.items)
    ? data.items.filter((raw) => raw != null).map((raw) => {
      const it = (raw ?? {}) as Record<string, unknown>;
      const quantity = parseLooseNumber(it.quantity);
      const unitValue = parseLooseNumber(it.unitValue);
      const lineTotalRaw = parseLooseNumber(it.lineTotal);
      return {
        ...it,
        productName: String(it.productName ?? "").trim() || "Item",
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 0.0001,
        unitValue: Number.isFinite(unitValue) ? unitValue : 0,
        lineTotal: Number.isFinite(lineTotalRaw)
          ? lineTotalRaw
          : (Number.isFinite(quantity) ? quantity : 0) * (Number.isFinite(unitValue) ? unitValue : 0),
        unitCommercial: it.unitCommercial == null ? null : String(it.unitCommercial),
        unitTax: it.unitTax == null ? null : String(it.unitTax),
        productCode: it.productCode == null ? null : String(it.productCode),
        ncm: it.ncm == null ? null : String(it.ncm),
        ean: it.ean == null ? null : String(it.ean),
      };
    })
    : [];
  return safeItems as ExtractedExpenseItem[];
}

/** Identidade estável por linha (det order = ordem do parse). */
export function buildXmlLineIdentities(items: ExtractedExpenseItem[]): string[] {
  return items.map((it, idx) => {
    const c =
      String((it as { productCode?: string | null }).productCode ?? "").trim() ||
      "noprod";
    const n = idx + 1;
    return `nItem:${n}:cProd:${c}`;
  });
}

export type LoadedNfeMotorContext = {
  items: ExtractedExpenseItem[];
  xml_line_identities: string[];
  xml_text: string | null;
  payload_enriched: ExtractedDocumentResult;
  import_job_file_id: string | null;
  import_job_batch_id: string | null;
  raw_rows_ordered: Array<{ id: string; expense_item_id: string | null }>;
};

/**
 * Monta contexto do motor a partir de `expense_items` (sem `company_nfe_import_logs`).
 */
export async function loadNfeMotorExtractContext(
  supabase: SupabaseClient,
  companyId: string,
  expenseId: string,
  _importJobFileIdHint?: string,
): Promise<LoadedNfeMotorContext | null> {
  const { data: expenseRow, error: expErr } = await supabase
    .from("expenses")
    .select("supplier_document, notes, financial_reconciliation_json")
    .eq("id", expenseId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (expErr || !expenseRow) {
    return null;
  }

  const { data: expenseItemRows, error: itemsErr } = await supabase
    .from("expense_items")
    .select(
      "id, product_name, quantity, unit_value, invoice_unit, ncm, ean, product_id",
    )
    .eq("expense_id", expenseId)
    .order("created_at", { ascending: true });

  if (itemsErr || !expenseItemRows?.length) {
    return null;
  }

  const rawItems = (expenseItemRows as Array<Record<string, unknown>>).map((row) => {
    const qty = parseLooseNumber(row.quantity);
    const unitValue = parseLooseNumber(row.unit_value);
    return {
      productName: String(row.product_name ?? "").trim() || "Item",
      quantity: qty > 0 ? qty : 0.0001,
      unitValue,
      lineTotal: qty * unitValue,
      unitCommercial: row.invoice_unit == null ? null : String(row.invoice_unit),
      ncm: row.ncm == null ? null : String(row.ncm),
      ean: row.ean == null ? null : String(row.ean),
      productCode: null,
    };
  });

  const payload = enrichExtractedWithTaxId({
    items: rawItems,
    supplierDocument: expenseRow.supplier_document ?? null,
    notes: expenseRow.notes ?? null,
  } as ExtractedDocumentResult);

  if (!payload?.items?.length) {
    return null;
  }

  const items = normalizeExtractedItemsLikeBatch(payload);
  const xml_line_identities = buildXmlLineIdentities(items);

  const expenseItemIds = (expenseItemRows as Array<{ id: string }>).map((r) =>
    String(r.id),
  );

  let rawCandidate: Array<{
    id: string;
    expense_item_id: string | null;
  }> = [];
  if (expenseItemIds.length > 0) {
    const { data: rr } = await supabase
      .from("onboarding_import_item_raw")
      .select("id, expense_item_id")
      .eq("company_id", companyId)
      .in("expense_item_id", expenseItemIds);
    rawCandidate = (rr ?? []) as Array<{
      id: string;
      expense_item_id: string | null;
    }>;
  }

  const byEi = new Map<string, { id: string; expense_item_id: string | null }>();
  for (const r of rawCandidate) {
    if (r.expense_item_id) byEi.set(String(r.expense_item_id), r);
  }

  const raw_rows_ordered = expenseItemIds.map((eid) => {
    return byEi.get(eid) ?? { id: "", expense_item_id: eid };
  });

  return {
    items,
    xml_line_identities,
    xml_text: null,
    payload_enriched: payload,
    import_job_file_id: null,
    import_job_batch_id: null,
    raw_rows_ordered,
  };
}

import { enrichExtractedWithTaxId } from "../expenseSupplierEnsure.ts";
import type { ExtractedDocumentResult, ExtractedExpenseItem } from "../openaiExpense.ts";
import { parseNfeXmlToExtracted } from "../parseNfeXml.ts";
import { strFromU8 } from "npm:fflate@0.8.2";

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
 * Normaliza itens tal como `process-import-job-batch` antes de `resolveProductMatches`,
 * garantindo paridade de fingerprint com o lote.
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

function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export type LoadedNfeMotorContext = {
  items: ExtractedExpenseItem[];
  xml_line_identities: string[];
  xml_text: string | null;
  payload_enriched: ExtractedDocumentResult;
  import_job_file_id: string | null;
  /** `import_job_files.batch_id` quando o XML veio de um lote. */
  import_job_batch_id: string | null;
  /** Linhas brutas onboarding ligadas aos `expense_items` desta despesa (ordenadas como os itens). */
  raw_rows_ordered: Array<{ id: string; expense_item_id: string | null }>;
};

/**
 * Carrega XML + payload coerentes com o lote (`company_nfe_import_logs` + ficheiro de job).
 */
export async function loadNfeMotorExtractContext(
  supabase: SupabaseClient,
  companyId: string,
  expenseId: string,
  importJobFileIdHint?: string,
): Promise<LoadedNfeMotorContext | null> {
  const q = importJobFileIdHint
    ? supabase
      .from("company_nfe_import_logs")
      .select("payload, import_job_file_id")
      .eq("company_id", companyId)
      .eq("expense_id", expenseId)
      .eq("import_job_file_id", importJobFileIdHint)
      .order("created_at", { ascending: false })
      .limit(1)
    : supabase
      .from("company_nfe_import_logs")
      .select("payload, import_job_file_id")
      .eq("company_id", companyId)
      .eq("expense_id", expenseId)
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .limit(1);

  const { data: logRow, error: logErr } = await q.maybeSingle();

  let xml_text: string | null = null;
  let payload: ExtractedDocumentResult | null = null;
  let import_job_file_id: string | null = null;
  let import_job_batch_id: string | null = null;

  if (!logErr && logRow?.payload && typeof logRow.payload === "object") {
    payload = enrichExtractedWithTaxId(
      logRow.payload as ExtractedDocumentResult,
    );
    import_job_file_id = logRow.import_job_file_id
      ? String(logRow.import_job_file_id)
      : null;

    const fileId = importJobFileIdHint ?? import_job_file_id;
    if (fileId) {
      const { data: fileRow } = await supabase
        .from("import_job_files")
        .select("xml_content_base64, batch_id")
        .eq("id", fileId)
        .eq("company_id", companyId)
        .maybeSingle();
      const fr = fileRow as { xml_content_base64?: string; batch_id?: string } | null;
      import_job_batch_id = fr?.batch_id ? String(fr.batch_id) : null;
      const b64 = fr?.xml_content_base64;
      if (b64 && b64.trim()) {
        try {
          xml_text = strFromU8(decodeBase64ToBytes(b64));
        } catch {
          xml_text = null;
        }
      }
    }
  }

  if (!payload?.items?.length) {
    return null;
  }

  if (!xml_text?.trim()) {
    return null;
  }

  let items = normalizeExtractedItemsLikeBatch(payload);

  const reparsed = parseNfeXmlToExtracted(xml_text);
  if (reparsed?.items?.length) {
    const repNorm = normalizeExtractedItemsLikeBatch(
      enrichExtractedWithTaxId(reparsed),
    );
    if (repNorm.length === items.length) {
      items = repNorm;
    }
  }

  const xml_line_identities = buildXmlLineIdentities(items);

  const { data: expenseItemRows } = await supabase
    .from("expense_items")
    .select("id")
    .eq("expense_id", expenseId)
    .order("created_at", { ascending: true });

  const expenseItemIds = (expenseItemRows ?? []).map((r: { id: string }) =>
    String(r.id)
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
  for (const r of rawCandidate as Array<{
    id: string;
    expense_item_id: string | null;
  }>) {
    if (r.expense_item_id) byEi.set(String(r.expense_item_id), r);
  }

  const raw_rows_ordered = expenseItemIds.map((eid) => {
    return byEi.get(eid) ?? { id: "", expense_item_id: eid };
  });

  return {
    items,
    xml_line_identities,
    xml_text,
    payload_enriched: payload,
    import_job_file_id,
    import_job_batch_id,
    raw_rows_ordered,
  };
}

/**
 * CPF/CNPJ e cadastro automático de fornecedor (mesma regra do fluxo WhatsApp).
 */
import type { ExtractedDocumentResult } from "./openaiExpense.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

/** Apenas dígitos; aceita número vindo do JSON. */
export function normalizeDocumentDigits(raw: string | null | undefined): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/**
 * CPF (11) ou CNPJ (14) a partir de supplierDocument, notes ou nome (OCR costuma
 * colocar CNPJ só no rodapé ou o modelo devolve snake_case/número errado).
 */
export function extractTaxIdDigits(
  extracted: ExtractedDocumentResult,
): string | null {
  const blocks: string[] = [];
  const push = (v: string | null | undefined) => {
    if (v && String(v).trim()) blocks.push(String(v));
  };
  push(extracted.supplierDocument);
  push(extracted.notes);
  push(extracted.supplierName);

  const pickFromDigits = (d: string): string | null => {
    let x = d.replace(/\D/g, "");
    if (x.length === 11 || x.length === 14) return x;
    if (x.length > 14) {
      x = x.slice(-14);
      return x.length === 14 ? x : null;
    }
    return null;
  };

  for (const b of blocks) {
    const n = pickFromDigits(b);
    if (n) return n;
  }

  const all = blocks.join(" ").replace(/\D/g, "");
  if (all.length >= 14) return all.slice(-14);
  if (all.length === 11) return all;
  return null;
}

/** Garante supplierDocument no JSON persistido. */
export function enrichExtractedWithTaxId(
  extracted: ExtractedDocumentResult,
): ExtractedDocumentResult {
  const digits = extractTaxIdDigits(extracted);
  if (!digits) return extracted;
  const cur = normalizeDocumentDigits(extracted.supplierDocument);
  if (cur === digits) return extracted;
  return { ...extracted, supplierDocument: digits };
}

const NOTES_WHATSAPP_DEFAULT =
  "Cadastrado automaticamente — importação WhatsApp";

export type EnsureSupplierFromExtractedResult = {
  supplierId: string | null;
  /** Novo registo em `suppliers`. */
  createdNew: boolean;
};

/**
 * Localiza fornecedor pelo documento ou cria com nome e documento.
 * `supplierId` fica null se não houver CPF/CNPJ válido (11 ou 14 dígitos) ou erro.
 */
export async function ensureSupplierFromExtracted(
  supabase: SupabaseClient,
  companyId: string,
  extracted: ExtractedDocumentResult,
  autoRegisterNotes: string = NOTES_WHATSAPP_DEFAULT,
): Promise<EnsureSupplierFromExtractedResult> {
  const digits = extractTaxIdDigits(extracted);
  if (!digits || (digits.length !== 11 && digits.length !== 14)) {
    return { supplierId: null, createdNew: false };
  }

  const { data: rows, error } = await supabase
    .from("suppliers")
    .select("id, document")
    .eq("company_id", companyId);

  if (error) {
    console.error("[expenseSupplierEnsure] suppliers list:", error.message);
    return { supplierId: null, createdNew: false };
  }

  const list = Array.isArray(rows) ? rows : [];
  const norm = (d: string | null | undefined) => normalizeDocumentDigits(d);
  const found = list.find((r: { document: string | null }) =>
    norm(r.document) === digits
  );
  if (found) return { supplierId: found.id as string, createdNew: false };

  const name =
    (extracted.supplierName ?? "").trim() ||
    (autoRegisterNotes.includes("WhatsApp")
      ? "Fornecedor (WhatsApp)"
      : "Fornecedor");
  const { data: inserted, error: insErr } = await supabase
    .from("suppliers")
    .insert({
      company_id: companyId,
      name,
      document: digits,
      notes: autoRegisterNotes,
    })
    .select("id")
    .single();

  if (insErr) {
    console.error("[expenseSupplierEnsure] insert supplier:", insErr.message);
    return { supplierId: null, createdNew: false };
  }
  const id = (inserted?.id as string) ?? null;
  return { supplierId: id, createdNew: !!id };
}

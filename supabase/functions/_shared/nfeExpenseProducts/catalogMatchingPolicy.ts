/**
 * Política única de opts para `resolveProductMatches` — paridade com o laboratório (IA + embeddings
 * em fluxos XML/lab) e kill-switch operacional.
 */

import type { ResolveProductMatchesOptions } from "../../received-whatsapp-message/productMatch.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

/** Contextos suportados pela política de matching. */
export type CatalogMatchContext =
  /**
   * Importação XML em lote / motor `process-expense-xml-products` / laboratório com paridade total.
   * Opts iguais a `PREVIEW_FULL` (importBatch + LLM assist + embeddings).
   */
  | "XML_BATCH_OR_LAB"
  /** Laboratório dev-preview com paridade de produção (sem «modo económico»). */
  | "PREVIEW_FULL"
  /** Opt-in explícito no laboratório — antigo `simulate_import_batch` (sem LLM/embeddings). */
  | "PREVIEW_ECONOMY"
  /** WhatsApp / rascunhos / imagem / PDF — comportamento legado (`opts` undefined). */
  | "WHATSAPP_INTERACTIVE";

export function envImportProductLlmDisabled(): boolean {
  try {
    const v =
      typeof Deno !== "undefined"
        ? Deno.env.get("IMPORT_PRODUCT_LLM_DISABLED") ?? ""
        : "";
    const s = String(v).trim().toLowerCase();
    return s === "true" || s === "1";
  } catch {
    return false;
  }
}

/** Desliga só o assist `assistInvoiceLineUnits` (nome/unidade por linha NF-e). */
export function envImportLineUnitsLlmDisabled(): boolean {
  try {
    const v =
      typeof Deno !== "undefined"
        ? Deno.env.get("IMPORT_LINE_UNITS_LLM_DISABLED") ?? ""
        : "";
    const s = String(v).trim().toLowerCase();
    return s === "true" || s === "1";
  } catch {
    return false;
  }
}

function applyKillSwitch(
  base: ResolveProductMatchesOptions | undefined,
): ResolveProductMatchesOptions | undefined {
  if (!envImportProductLlmDisabled()) return base;
  if (base === undefined) {
    return { skipLlmAssist: true, skipEmbeddingBackfill: true };
  }
  return {
    ...base,
    skipLlmAssist: true,
    skipEmbeddingBackfill: true,
  };
}

function baseOptsForContext(
  context: CatalogMatchContext,
): ResolveProductMatchesOptions | undefined {
  switch (context) {
    case "XML_BATCH_OR_LAB":
    case "PREVIEW_FULL":
      return {
        importBatch: true,
        skipEmbeddingBackfill: false,
        skipLlmAssist: false,
      };
    case "PREVIEW_ECONOMY":
      return {
        importBatch: true,
        skipEmbeddingBackfill: true,
        skipLlmAssist: true,
      };
    case "WHATSAPP_INTERACTIVE":
    default:
      return undefined;
  }
}

/**
 * Toca `company_product_import_settings` para manter o contrato «serviço + settings» e devolve os opts
 * efectivos, incluindo override do kill-switch `IMPORT_PRODUCT_LLM_DISABLED`.
 */
export async function getDefaultCatalogMatchingOpts(
  supabase: SupabaseClient,
  companyId: string,
  context: CatalogMatchContext,
): Promise<ResolveProductMatchesOptions | undefined> {
  const { error } = await supabase
    .from("company_product_import_settings")
    .select("company_id")
    .eq("company_id", companyId)
    .maybeSingle();

  void error;

  return applyKillSwitch(baseOptsForContext(context));
}

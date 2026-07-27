/**
 * Política única de opts para `resolveProductMatches`.
 * Vínculo de produtos é determinístico (EAN / cProd+fornecedor); sem IA.
 */

import type { ResolveProductMatchesOptions } from "../../received-whatsapp-message/productMatch.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

/** Contextos suportados pela política de matching. */
export type CatalogMatchContext =
  /**
   * Importação XML em lote / motor `process-expense-xml-products` / laboratório.
   */
  | "XML_BATCH_OR_LAB"
  /** Laboratório dev-preview com paridade de produção. */
  | "PREVIEW_FULL"
  /** Opt-in no laboratório — mesmo comportamento (sem IA). */
  | "PREVIEW_ECONOMY"
  /** WhatsApp / rascunhos / imagem / PDF. */
  | "WHATSAPP_INTERACTIVE";

/** @deprecated Sempre true — vínculo por IA removido. */
export function envImportProductLlmDisabled(): boolean {
  return true;
}

/** @deprecated Sempre true — assist de unidades por IA removido. */
export function envImportLineUnitsLlmDisabled(): boolean {
  return true;
}

function baseOptsForContext(
  context: CatalogMatchContext,
): ResolveProductMatchesOptions | undefined {
  switch (context) {
    case "XML_BATCH_OR_LAB":
    case "PREVIEW_FULL":
    case "PREVIEW_ECONOMY":
      return {
        importBatch: true,
        skipEmbeddingBackfill: true,
        skipLlmAssist: true,
      };
    case "WHATSAPP_INTERACTIVE":
    default:
      return {
        skipLlmAssist: true,
        skipEmbeddingBackfill: true,
      };
  }
}

/**
 * Toca `company_product_import_settings` para manter o contrato «serviço + settings»
 * e devolve opts sem IA.
 */
export async function getDefaultCatalogMatchingOpts(
  supabase: SupabaseClient,
  companyId: string,
  context: CatalogMatchContext,
  extra?: Pick<ResolveProductMatchesOptions, "supplierId">,
): Promise<ResolveProductMatchesOptions | undefined> {
  const { error } = await supabase
    .from("company_product_import_settings")
    .select("company_id")
    .eq("company_id", companyId)
    .maybeSingle();

  void error;

  const base = baseOptsForContext(context);
  if (!base && !extra?.supplierId) return undefined;
  return {
    ...(base ?? {}),
    ...(extra?.supplierId != null ? { supplierId: extra.supplierId } : {}),
  };
}

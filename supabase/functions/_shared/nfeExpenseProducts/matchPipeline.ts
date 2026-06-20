import { resolveProductMatches } from "../../received-whatsapp-message/productMatch.ts";
import type { ExtractedExpenseItem } from "../openaiExpense.ts";
import { applyInvoiceLineUnitsAssistToItems } from "../productImport/invoiceLineUnitsProduction.ts";
import {
  envImportLineUnitsLlmDisabled,
  envImportProductLlmDisabled,
  getDefaultCatalogMatchingOpts,
  type CatalogMatchContext,
} from "./catalogMatchingPolicy.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

function shouldRunInvoiceLineUnitsAssist(
  context: CatalogMatchContext,
  skipLlmAssist: boolean | undefined,
): boolean {
  if (context !== "XML_BATCH_OR_LAB" && context !== "PREVIEW_FULL") {
    return false;
  }
  if (skipLlmAssist) return false;
  if (envImportProductLlmDisabled()) return false;
  if (envImportLineUnitsLlmDisabled()) return false;
  return true;
}

export async function matchNfeExpenseCatalogLines(
  supabase: SupabaseClient,
  companyId: string,
  items: ExtractedExpenseItem[],
  context: CatalogMatchContext,
) {
  const opts = await getDefaultCatalogMatchingOpts(supabase, companyId, context);
  const base = await resolveProductMatches(supabase, companyId, items, opts);

  if (
    !shouldRunInvoiceLineUnitsAssist(context, opts?.skipLlmAssist) ||
    !base.items.length
  ) {
    return { ...base, lineUnitsLlmCalls: base.lineUnitsLlmCalls ?? 0 };
  }

  const { items: enriched, lineUnitsLlmCalls } =
    await applyInvoiceLineUnitsAssistToItems({
      supabase,
      companyId,
      items: base.items,
    });

  return {
    ...base,
    items: enriched,
    lineUnitsLlmCalls,
  };
}

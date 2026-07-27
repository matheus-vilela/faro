import { resolveProductMatches } from "../../received-whatsapp-message/productMatch.ts";
import type { ExtractedExpenseItem } from "../openaiExpense.ts";
import {
  getDefaultCatalogMatchingOpts,
  type CatalogMatchContext,
} from "./catalogMatchingPolicy.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export async function matchNfeExpenseCatalogLines(
  supabase: SupabaseClient,
  companyId: string,
  items: ExtractedExpenseItem[],
  context: CatalogMatchContext,
  opts?: { supplierId?: string | null },
) {
  const matchOpts = await getDefaultCatalogMatchingOpts(
    supabase,
    companyId,
    context,
    opts?.supplierId != null ? { supplierId: opts.supplierId } : undefined,
  );
  const base = await resolveProductMatches(
    supabase,
    companyId,
    items,
    matchOpts,
  );

  return { ...base, lineUnitsLlmCalls: 0 };
}

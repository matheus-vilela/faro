import { resolveProductMatches } from "../../received-whatsapp-message/productMatch.ts";
import type { ExtractedExpenseItem } from "../openaiExpense.ts";
import { getDefaultCatalogMatchingOpts, type CatalogMatchContext } from "./catalogMatchingPolicy.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export async function matchNfeExpenseCatalogLines(
  supabase: SupabaseClient,
  companyId: string,
  items: ExtractedExpenseItem[],
  context: CatalogMatchContext,
) {
  const opts = await getDefaultCatalogMatchingOpts(supabase, companyId, context);
  return resolveProductMatches(supabase, companyId, items, opts);
}

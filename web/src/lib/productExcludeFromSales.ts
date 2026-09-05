import { supabase } from "@/lib/supabase";

export function isProductExcludedFromSales(
  product: { exclude_from_sales?: boolean | null } | null | undefined,
): boolean {
  return product?.exclude_from_sales === true;
}

export function excludedProductIdsFromRows(
  products: Array<{ id: string; exclude_from_sales?: boolean | null }>,
): Set<string> {
  const ids = new Set<string>();
  for (const p of products) {
    if (p.exclude_from_sales === true) ids.add(p.id);
  }
  return ids;
}

export function revenueEntryAppearsAsSale(
  entry: { entry_mode?: string | null; product_id?: string | null },
  excludedProductIds?: ReadonlySet<string> | null,
): boolean {
  if (
    entry.entry_mode === "product_sale" &&
    entry.product_id &&
    excludedProductIds?.has(entry.product_id)
  ) {
    return false;
  }
  return true;
}

export function filterRevenueEntriesAppearingAsSale<
  T extends { entry_mode?: string | null; product_id?: string | null },
>(
  entries: T[],
  excludedProductIds?: ReadonlySet<string> | null,
): T[] {
  if (!excludedProductIds || excludedProductIds.size === 0) return entries;
  return entries.filter((e) =>
    revenueEntryAppearsAsSale(e, excludedProductIds),
  );
}

/** PostgREST: mantém lançamentos que não são venda de produto excluído. */
export function applyRevenueExcludeFromSalesFilter(
  // PostgrestFilterBuilder; tipagem do client é instável aqui.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  excludedProductIds: readonly string[],
) {
  if (excludedProductIds.length === 0) return query;
  return query.or(
    `entry_mode.neq.product_sale,product_id.not.in.(${excludedProductIds.join(",")})`,
  );
}

export function sumRevenueCmvAppearingAsSale(
  rows: Array<{
    cmv_amount?: number | null;
    product_id?: string | null;
    entry_mode?: string | null;
  }>,
  excludedProductIds?: ReadonlySet<string> | null,
): number {
  return rows.reduce((s, r) => {
    if (!revenueEntryAppearsAsSale(r, excludedProductIds)) return s;
    return s + Math.max(0, Number(r.cmv_amount) || 0);
  }, 0);
}

export async function fetchExcludedFromSalesProductIds(
  companyId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id")
    .eq("company_id", companyId)
    .eq("exclude_from_sales", true);
  if (error) throw error;
  return (data ?? []).map((r) => String((r as { id: string }).id));
}

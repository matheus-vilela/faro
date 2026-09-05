import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/product";

function ilikeContains(term: string): string {
  return `%${term.replace(/[%_\\]/g, "\\$&")}%`;
}

export function productMatchesUnifySearch(
  product: Pick<Product, "name" | "sku" | "ean" | "barcode" | "merged_catalog_names">,
  term: string,
): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  if (product.name.toLowerCase().includes(t)) return true;
  if ((product.sku ?? "").toLowerCase().includes(t)) return true;
  if ((product.ean ?? "").toLowerCase().includes(t)) return true;
  if ((product.barcode ?? "").toLowerCase().includes(t)) return true;
  return (product.merged_catalog_names ?? []).some((name) =>
    name.toLowerCase().includes(t),
  );
}

/** Produtos do catálogo para unificar — não a fila de correlação. */
export async function searchProductsForUnify(input: {
  companyId: string;
  excludeId: string;
  term: string;
  limit?: number;
}): Promise<Product[]> {
  const limit = input.limit ?? 80;
  const term = input.term.trim();

  let q = supabase
    .from("products")
    .select("*")
    .eq("company_id", input.companyId)
    .neq("id", input.excludeId)
    .eq("listed_in_product_catalog", true)
    .or("is_active.is.null,is_active.eq.true")
    .order("name")
    .limit(limit);

  if (term) {
    q = q.ilike("name", ilikeContains(term));
  }

  const { data, error } = await q;
  const byId = new Map<string, Product>();
  if (!error) {
    for (const row of (data ?? []) as Product[]) byId.set(row.id, row);
  }

  if (term) {
    const skuRes = await supabase
      .from("products")
      .select("*")
      .eq("company_id", input.companyId)
      .neq("id", input.excludeId)
      .eq("listed_in_product_catalog", true)
      .or("is_active.is.null,is_active.eq.true")
      .or(
        `sku.ilike.${ilikeContains(term)},ean.ilike.${ilikeContains(term)},barcode.ilike.${ilikeContains(term)}`,
      )
      .limit(40);
    if (!skuRes.error) {
      for (const row of (skuRes.data ?? []) as Product[]) byId.set(row.id, row);
    }

    const hubRes = await supabase
      .from("products")
      .select("*")
      .eq("company_id", input.companyId)
      .neq("id", input.excludeId)
      .eq("listed_in_product_catalog", true)
      .or("is_active.is.null,is_active.eq.true")
      .not("merged_catalog_names", "eq", "{}")
      .limit(200);
    if (!hubRes.error) {
      for (const row of (hubRes.data ?? []) as Product[]) {
        if (productMatchesUnifySearch(row, term)) byId.set(row.id, row);
      }
    }
  }

  return [...byId.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );
}

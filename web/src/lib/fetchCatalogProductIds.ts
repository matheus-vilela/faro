import { supabase } from "@/lib/supabase";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import {
  matchesPurchasesMetric,
  type PurchasesDashboardMetric,
} from "@/lib/productPurchasesDashboard";
import type { Product } from "@/types/product";

export type CatalogProductFilterParams = {
  companyId: string;
  categoryProductIds: string[] | null;
  search: string;
  filterActive: "all" | "active" | "inactive";
  filterComposesCmv: "all" | "yes" | "no";
  bounds: { gte?: string; lte?: string } | null;
  lowStockOnly: boolean;
  filterStockAlert: "all" | "zero" | "below_min" | "any";
  purchasesFilter: PurchasesDashboardMetric | null;
};

function buildCatalogProductsQuery(params: CatalogProductFilterParams) {
  let q = supabase
    .from("products")
    .select("id")
    .eq("company_id", params.companyId)
    .eq("listed_in_product_catalog", true)
    .order("name");

  if (params.categoryProductIds) {
    q = q.in("id", params.categoryProductIds);
  }
  if (params.search.trim()) {
    const term = `%${params.search.trim()}%`;
    q = q.or(`name.ilike.${term},sku.ilike.${term}`);
  }
  if (params.filterActive === "active") {
    q = q.or("is_active.is.null,is_active.eq.true");
  } else if (params.filterActive === "inactive") {
    q = q.eq("is_active", false);
  }
  if (params.filterComposesCmv === "yes") {
    q = q.or("composes_cmv.is.null,composes_cmv.eq.true");
  } else if (params.filterComposesCmv === "no") {
    q = q.eq("composes_cmv", false);
  }
  if (params.bounds?.gte) {
    q = q.gte("updated_at", params.bounds.gte);
  }
  if (params.bounds?.lte) {
    q = q.lte("updated_at", params.bounds.lte);
  }
  if (params.lowStockOnly) {
    q = q.eq("stock_below_min_inclusive", true);
  } else if (params.filterStockAlert === "zero") {
    q = q.eq("stock_is_zero", true);
  } else if (params.filterStockAlert === "below_min") {
    q = q.eq("stock_below_min_positive", true);
  } else if (params.filterStockAlert === "any") {
    q = q.eq("stock_has_alert", true);
  }

  return q;
}

export async function fetchCatalogProductIds(
  params: CatalogProductFilterParams,
): Promise<string[]> {
  if (params.purchasesFilter) {
    const all = await fetchAllInRange<Product>(
      supabase
        .from("products")
        .select("*")
        .eq("company_id", params.companyId)
        .eq("listed_in_product_catalog", true)
        .order("name"),
    );
    return all
      .filter((p) => matchesPurchasesMetric(p, params.purchasesFilter!))
      .map((p) => p.id);
  }

  const rows = await fetchAllInRange<{ id: string }>(
    buildCatalogProductsQuery(params),
  );
  return rows.map((r) => r.id);
}

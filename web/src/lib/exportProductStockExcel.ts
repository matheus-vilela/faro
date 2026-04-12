import * as XLSX from "xlsx";

import {
  type ProductExportFilterState,
  updatedAtFilterBounds,
} from "@/lib/productCatalogFilters";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/product";

const PAGE = 1000;

async function fetchProductCatalogNamesByProduct(
  companyId: string,
  productIds: string[],
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (productIds.length === 0) return out;
  const { data: links, error } = await supabase
    .from("product_category_assignments")
    .select("product_id, category_id")
    .in("product_id", productIds);
  if (error || !links?.length) return out;
  const catIds = [...new Set(links.map((l) => l.category_id))];
  const { data: cats } = await supabase
    .from("company_product_categories")
    .select("id, name")
    .eq("company_id", companyId)
    .in("id", catIds);
  const catById = new Map((cats ?? []).map((c) => [c.id, c.name as string]));
  for (const row of links) {
    const name = catById.get(row.category_id);
    if (!name) continue;
    const list = out[row.product_id] ?? [];
    list.push(name);
    out[row.product_id] = list;
  }
  for (const id of Object.keys(out)) {
    out[id]!.sort((a, b) => a.localeCompare(b, "pt-BR"));
  }
  return out;
}

function buildFilteredQuery(companyId: string, f: ProductExportFilterState) {
  const bounds = updatedAtFilterBounds(
    f.filterUpdatedPreset,
    f.filterUpdatedFrom,
    f.filterUpdatedTo,
  );
  let q = supabase
    .from("products")
    .select("*")
    .eq("company_id", companyId)
    .order("name");

  if (f.lowStockOnly) {
    q = q.eq("stock_below_min_inclusive", true);
  } else if (f.filterStockAlert === "zero") {
    q = q.eq("stock_is_zero", true);
  } else if (f.filterStockAlert === "below_min") {
    q = q.eq("stock_below_min_positive", true);
  } else if (f.filterStockAlert === "any") {
    q = q.eq("stock_has_alert", true);
  }

  if (f.search.trim()) {
    const term = `%${f.search.trim()}%`;
    q = q.or(`name.ilike.${term},sku.ilike.${term}`);
  }
  if (f.filterActive === "active") {
    q = q.or("is_active.is.null,is_active.eq.true");
  } else if (f.filterActive === "inactive") {
    q = q.eq("is_active", false);
  }
  if (f.filterComposesCmv === "yes") {
    q = q.or("composes_cmv.is.null,composes_cmv.eq.true");
  } else if (f.filterComposesCmv === "no") {
    q = q.eq("composes_cmv", false);
  }
  if (bounds?.gte) {
    q = q.gte("updated_at", bounds.gte);
  }
  if (bounds?.lte) {
    q = q.lte("updated_at", bounds.lte);
  }
  return q;
}

/** Lista todos os produtos que atendem aos filtros (paginação interna). */
export async function fetchProductsForStockExport(
  companyId: string,
  filters: ProductExportFilterState,
  mode: "filtered" | "all",
): Promise<Product[]> {
  let categoryProductIds: string[] | null = null;
  if (mode === "filtered" && filters.filterCategoryId !== "all") {
    const { data: links, error } = await supabase
      .from("product_category_assignments")
      .select("product_id")
      .eq("category_id", filters.filterCategoryId);
    if (error) throw error;
    categoryProductIds = [...new Set((links ?? []).map((l) => l.product_id))];
    if (categoryProductIds.length === 0) {
      return [];
    }
  }

  const runQuery = () => {
    if (mode === "all") {
      return supabase
        .from("products")
        .select("*")
        .eq("company_id", companyId)
        .order("name");
    }
    let q = buildFilteredQuery(companyId, filters);
    if (categoryProductIds) {
      q = q.in("id", categoryProductIds);
    }
    return q;
  };

  const all: Product[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await runQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = (data ?? []) as Product[];
    all.push(...batch);
    if (batch.length < PAGE) break;
  }
  return all;
}

function formatMoney(n: number | null | undefined): string | number {
  if (n == null || Number.isNaN(Number(n))) return "";
  return Number(n);
}

/** Monta o arquivo .xlsx e dispara o download no navegador. */
export function exportProductStockToExcel(
  products: Product[],
  categoryNamesByProductId: Record<string, string[]>,
  fileBasename: string,
): void {
  const rows = products.map((p) => {
    const cats = categoryNamesByProductId[p.id] ?? [];
    return {
      ID: p.id,
      Produto: p.name,
      Quantidade: Number(p.current_quantity),
      Unidade: p.unit,
      "Último preço": formatMoney(p.last_unit_value),
      "Preço médio": formatMoney(p.average_cost),
      "Estoque mínimo": Number(p.min_quantity ?? 0),
      Categorias: cats.length ? cats.join(", ") : "",
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Estoque");
  const safe = fileBasename.replace(/[^\w\-]+/g, "_").slice(0, 80);
  XLSX.writeFile(wb, `${safe || "estoque"}.xlsx`);
}

export async function runStockExportDownload(
  companyId: string,
  companyLabel: string,
  filters: ProductExportFilterState,
  mode: "filtered" | "all",
): Promise<number> {
  const products = await fetchProductsForStockExport(companyId, filters, mode);
  if (products.length === 0) {
    return 0;
  }
  const map = await fetchProductCatalogNamesByProduct(
    companyId,
    products.map((p) => p.id),
  );
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const suffix = mode === "all" ? "todos" : "filtrado";
  const base = `estoque_${suffix}_${companyLabel}_${stamp}`;
  exportProductStockToExcel(products, map, base);
  return products.length;
}

import { productStockValue, productUnitCost } from "@/lib/productCatalogValue";
import type { Product } from "@/types/product";

export type CatalogSortKey =
  | "name"
  | "sku"
  | "qty"
  | "min"
  | "price"
  | "value";

const CATALOG_SORT_COLUMN: Record<CatalogSortKey, string> = {
  name: "name",
  sku: "sku",
  qty: "current_quantity",
  min: "min_quantity",
  price: "catalog_unit_cost",
  value: "catalog_stock_value",
};

const TEXT_SORT_KEYS: CatalogSortKey[] = ["name", "sku"];

export function nextCatalogSort(
  currentKey: CatalogSortKey,
  currentAsc: boolean,
  clicked: CatalogSortKey,
): { sortKey: CatalogSortKey; sortAsc: boolean } {
  if (currentKey === clicked) {
    return { sortKey: clicked, sortAsc: !currentAsc };
  }
  return {
    sortKey: clicked,
    sortAsc: TEXT_SORT_KEYS.includes(clicked),
  };
}

export function compareCatalogProducts(
  a: Product,
  b: Product,
  key: CatalogSortKey,
): number {
  if (key === "name") return a.name.localeCompare(b.name, "pt-BR");
  if (key === "sku") {
    return (a.sku ?? "").localeCompare(b.sku ?? "", "pt-BR");
  }
  if (key === "qty") {
    return Number(a.current_quantity) - Number(b.current_quantity);
  }
  if (key === "min") {
    return Number(a.min_quantity ?? 0) - Number(b.min_quantity ?? 0);
  }
  if (key === "price") {
    return (productUnitCost(a) ?? -1) - (productUnitCost(b) ?? -1);
  }
  return (productStockValue(a) ?? -1) - (productStockValue(b) ?? -1);
}

export function sortCatalogProducts(
  rows: Product[],
  sortKey: CatalogSortKey,
  sortAsc: boolean,
): Product[] {
  return [...rows].sort((a, b) => {
    const cmp = compareCatalogProducts(a, b, sortKey);
    if (cmp !== 0) return sortAsc ? cmp : -cmp;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

type OrderableQuery<Q> = {
  order: (
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ) => Q;
};

export function applyCatalogProductOrder<Q extends OrderableQuery<Q>>(
  query: Q,
  sortKey: CatalogSortKey,
  sortAsc: boolean,
): Q {
  let next = query.order(CATALOG_SORT_COLUMN[sortKey], {
    ascending: sortAsc,
    nullsFirst: false,
  });
  if (sortKey !== "name") {
    next = next.order("name", { ascending: true });
  }
  return next;
}

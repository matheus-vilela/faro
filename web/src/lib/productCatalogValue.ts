import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/product";

export function productUnitCost(
  p: Pick<
    Product,
    "average_cost" | "last_unit_value" | "last_unit_value_stock"
  >,
): number | null {
  const cmv =
    p.average_cost != null && p.average_cost > 0
      ? Number(p.average_cost)
      : null;
  const lastStock =
    p.last_unit_value_stock != null && p.last_unit_value_stock > 0
      ? Number(p.last_unit_value_stock)
      : null;
  const last =
    p.last_unit_value != null && p.last_unit_value > 0
      ? Number(p.last_unit_value)
      : null;
  return cmv ?? lastStock ?? last;
}

export function productStockValue(
  p: Pick<
    Product,
    | "current_quantity"
    | "average_cost"
    | "last_unit_value"
    | "last_unit_value_stock"
  >,
): number | null {
  const unit = productUnitCost(p);
  if (unit == null) return null;
  return Number(p.current_quantity) * unit;
}

export type CatalogStockKpis = {
  activeCount: number;
  stockValue: number;
  belowMinCount: number;
  zeroCount: number;
};

export async function fetchCatalogStockKpis(
  companyId: string,
): Promise<CatalogStockKpis> {
  const { data, error } = await supabase
    .from("products")
    .select(
      "current_quantity, average_cost, last_unit_value, last_unit_value_stock, stock_is_zero, stock_below_min_inclusive",
    )
    .eq("company_id", companyId)
    .eq("listed_in_product_catalog", true)
    .or("is_active.is.null,is_active.eq.true");
  if (error) {
    console.error(error);
    return { activeCount: 0, stockValue: 0, belowMinCount: 0, zeroCount: 0 };
  }
  const rows = data ?? [];
  let stockValue = 0;
  let belowMinCount = 0;
  let zeroCount = 0;
  for (const row of rows) {
    const value = productStockValue(row);
    if (value != null) stockValue += value;
    if (row.stock_below_min_inclusive) belowMinCount += 1;
    if (row.stock_is_zero) zeroCount += 1;
  }
  return {
    activeCount: rows.length,
    stockValue,
    belowMinCount,
    zeroCount,
  };
}

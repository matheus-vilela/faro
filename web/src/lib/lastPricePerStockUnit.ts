import {
  convertQuantityWithHubCodes,
  convertUnitPriceForProduct,
} from "@/lib/companyUnits/convert";
import { parseProductUnitConversionsJson } from "@/lib/productUnitConversionsJson";
import type { Product } from "@/types/product";

export type LastPriceConversionRow = {
  primary_qty: number;
  primary_unit_code: string;
  secondary_qty: number;
  secondary_unit_code: string;
};

function normUnit(code: string | null | undefined): string {
  return (code ?? "").trim().toLowerCase();
}

export function lastPriceDisplayUnit(
  product: Pick<Product, "unit" | "last_unit_value_unit_code">,
): string {
  return (
    product.last_unit_value_unit_code?.trim() ||
    product.unit?.trim() ||
    ""
  );
}

/** Preço já gravado na unidade do último pagamento. */
export function lastPriceRecorded(
  product: Pick<Product, "last_unit_value">,
): number | null {
  return product.last_unit_value != null && product.last_unit_value > 0
    ? Number(product.last_unit_value)
    : null;
}

/** Quantas unidades de estoque cabem em 1 unidade do preço (ex. 1 cx → 12 un). */
export function stockQtyPerPriceUnit(
  priceUnit: string,
  stockUnit: string,
  rows: LastPriceConversionRow[],
): number | null {
  const from = normUnit(priceUnit);
  const to = normUnit(stockUnit);
  if (!from || !to) return null;
  if (from === to) return 1;

  const system = convertQuantityWithHubCodes(1, from, to, to, []);
  if (system != null && Number.isFinite(system) && system > 0) return system;

  for (const row of rows) {
    const primary = normUnit(row.primary_unit_code);
    const secondary = normUnit(row.secondary_unit_code);
    const primaryQty = Number(row.primary_qty);
    const secondaryQty = Number(row.secondary_qty);
    if (
      !(primaryQty > 0) ||
      !(secondaryQty > 0) ||
      !Number.isFinite(primaryQty) ||
      !Number.isFinite(secondaryQty)
    ) {
      continue;
    }
    if (primary === from && secondary === to) {
      return secondaryQty / primaryQty;
    }
    if (primary === to && secondary === from) {
      return primaryQty / secondaryQty;
    }
  }
  return null;
}

function conversionRowsForProduct(
  product: Pick<Product, "id" | "company_id" | "unit_conversions">,
  conversions?: LastPriceConversionRow[],
): LastPriceConversionRow[] {
  if (conversions && conversions.length > 0) return conversions;
  return parseProductUnitConversionsJson(
    product.unit_conversions,
    product.company_id,
    product.id,
  );
}

/**
 * Equivalente por unidade de estoque, só quando o último preço está em outra unidade.
 * Sempre pela conversão (cx → un, kg → g, …) — não usa `last_unit_value_stock`.
 */
export function lastPricePerStockUnit(
  product: Pick<
    Product,
    | "id"
    | "company_id"
    | "unit"
    | "last_unit_value"
    | "last_unit_value_unit_code"
    | "unit_conversions"
  >,
  conversions?: LastPriceConversionRow[],
): number | null {
  const last = lastPriceRecorded(product);
  if (last == null) return null;

  const priceUnit = normUnit(lastPriceDisplayUnit(product));
  const stockUnit = normUnit(product.unit);
  if (!priceUnit || !stockUnit || priceUnit === stockUnit) return null;

  const rows = conversionRowsForProduct(product, conversions);
  const stockPerPrice = stockQtyPerPriceUnit(priceUnit, stockUnit, rows);
  if (stockPerPrice != null && stockPerPrice > 0) {
    const perStock = last / stockPerPrice;
    return perStock > 0 && Number.isFinite(perStock) ? perStock : null;
  }

  const viaStockHub = convertUnitPriceForProduct(
    last,
    priceUnit,
    stockUnit,
    stockUnit,
    rows,
  );
  if (viaStockHub != null && viaStockHub > 0) return viaStockHub;

  const viaPriceHub = convertUnitPriceForProduct(
    last,
    priceUnit,
    stockUnit,
    priceUnit,
    rows,
  );
  return viaPriceHub != null && viaPriceHub > 0 ? viaPriceHub : null;
}

/** Último preço em outra unidade, sem conversão para calcular o proporcional. */
export function lastPriceNeedsConversion(
  product: Pick<
    Product,
    | "id"
    | "company_id"
    | "unit"
    | "last_unit_value"
    | "last_unit_value_unit_code"
    | "unit_conversions"
  >,
  conversions?: LastPriceConversionRow[],
): boolean {
  const last = lastPriceRecorded(product);
  if (last == null) return false;
  const priceUnit = normUnit(lastPriceDisplayUnit(product));
  const stockUnit = normUnit(product.unit);
  if (!priceUnit || !stockUnit || priceUnit === stockUnit) return false;
  return lastPricePerStockUnit(product, conversions) == null;
}

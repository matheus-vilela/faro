import { PRODUCT_CATALOG_PATH } from "@/lib/productStockPaths";

/** Estoque crítico: saldo ≤ 20% do mínimo configurado. */
export const CRITICAL_STOCK_RATIO = 0.2;

/** Janela para preço possivelmente desatualizado (~2 meses). */
export const STALE_PRICE_MS = 60 * 24 * 60 * 60 * 1000;

export type ProductPurchasesSnapshot = {
  min_quantity: number;
  current_quantity: number;
  last_unit_value: number | null;
  last_unit_value_stock?: number | null;
  average_cost?: number | null;
  updated_at: string;
};

export type PurchasesDashboardMetric =
  | "critical"
  | "no_price"
  | "no_min"
  | "stale_price";

export function productHasUnitPrice(p: ProductPurchasesSnapshot): boolean {
  const avg =
    p.average_cost != null && Number.isFinite(Number(p.average_cost)) &&
    Number(p.average_cost) > 0;
  const last =
    p.last_unit_value != null &&
    Number.isFinite(Number(p.last_unit_value)) &&
    Number(p.last_unit_value) > 0;
  const lastStock =
    p.last_unit_value_stock != null &&
    Number.isFinite(Number(p.last_unit_value_stock)) &&
    Number(p.last_unit_value_stock) > 0;
  return avg || last || lastStock;
}

export function isCriticalStockProduct(p: ProductPurchasesSnapshot): boolean {
  const min = Number(p.min_quantity);
  const cur = Number(p.current_quantity);
  if (!Number.isFinite(min) || min <= 0) return false;
  if (!Number.isFinite(cur)) return false;
  return cur <= min * CRITICAL_STOCK_RATIO;
}

export function isProductWithoutPrice(p: ProductPurchasesSnapshot): boolean {
  return !productHasUnitPrice(p);
}

export function isProductWithoutMinStock(p: ProductPurchasesSnapshot): boolean {
  const min = Number(p.min_quantity ?? 0);
  return !Number.isFinite(min) || min <= 0;
}

export function isProductWithStalePrice(
  p: ProductPurchasesSnapshot,
  nowMs = Date.now(),
): boolean {
  if (!productHasUnitPrice(p)) return false;
  const updated = Date.parse(p.updated_at);
  if (!Number.isFinite(updated)) return true;
  return nowMs - updated >= STALE_PRICE_MS;
}

export function matchesPurchasesMetric(
  p: ProductPurchasesSnapshot,
  metric: PurchasesDashboardMetric,
  nowMs = Date.now(),
): boolean {
  switch (metric) {
    case "critical":
      return isCriticalStockProduct(p);
    case "no_price":
      return isProductWithoutPrice(p);
    case "no_min":
      return isProductWithoutMinStock(p);
    case "stale_price":
      return isProductWithStalePrice(p, nowMs);
    default:
      return false;
  }
}

export type PurchasesDashboardCounts = {
  criticalStock: number;
  withoutPrice: number;
  withoutMinStock: number;
  stalePrice: number;
};

export function computePurchasesDashboardCounts(
  rows: ProductPurchasesSnapshot[],
  nowMs = Date.now(),
): PurchasesDashboardCounts {
  let criticalStock = 0;
  let withoutPrice = 0;
  let withoutMinStock = 0;
  let stalePrice = 0;
  for (const p of rows) {
    if (isCriticalStockProduct(p)) criticalStock += 1;
    if (isProductWithoutPrice(p)) withoutPrice += 1;
    if (isProductWithoutMinStock(p)) withoutMinStock += 1;
    if (isProductWithStalePrice(p, nowMs)) stalePrice += 1;
  }
  return { criticalStock, withoutPrice, withoutMinStock, stalePrice };
}

export function purchasesMetricProductsHref(
  metric: PurchasesDashboardMetric,
): string {
  return `${PRODUCT_CATALOG_PATH}?compras=${metric}`;
}

export function parsePurchasesMetricParam(
  value: string | null,
): PurchasesDashboardMetric | null {
  if (
    value === "critical" ||
    value === "no_price" ||
    value === "no_min" ||
    value === "stale_price"
  ) {
    return value;
  }
  return null;
}

export const PURCHASES_METRIC_LABELS: Record<
  PurchasesDashboardMetric,
  string
> = {
  critical: "estoque crítico",
  no_price: "sem preço",
  no_min: "sem estoque mínimo",
  stale_price: "preço desatualizado",
};

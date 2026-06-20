import {
  convertQuantityForProduct,
  getLockedSystemSecondaryQty,
} from "@/lib/companyUnits/convert";
import { roundHubQuantityForStock } from "@/lib/productQuantityInput";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";

export function allowedUnitsForProduct(
  product: Product | undefined,
  conversions: ProductUnitConversionDraft[],
): string[] {
  if (!product) return [];
  const base = product.unit;
  const allowed = new Set<string>([base]);
  for (const c of conversions) {
    if (
      c.primary_unit_code?.trim().toLowerCase() === base.trim().toLowerCase()
    ) {
      allowed.add(c.secondary_unit_code);
    }
  }
  for (const candidate of ["mg", "g", "kg", "ml", "l"]) {
    if (candidate.toLowerCase() === base.trim().toLowerCase()) continue;
    if (getLockedSystemSecondaryQty(1, base, candidate) != null) {
      allowed.add(candidate);
    }
  }
  return [...allowed];
}

export function toStockBaseQuantity(
  product: Product,
  qty: number,
  fromUnit: string,
  conversions: ProductUnitConversionDraft[],
): number | null {
  const convs = conversions.map((r) => ({
    primary_unit_code: r.primary_unit_code,
    secondary_unit_code: r.secondary_unit_code,
    primary_qty: Number(r.primary_qty),
    secondary_qty: Number(r.secondary_qty),
  }));
  const raw = convertQuantityForProduct(
    Math.abs(qty),
    fromUnit,
    product.unit,
    product.unit,
    convs,
  );
  return raw == null ? null : roundHubQuantityForStock(raw);
}

export function formatCurrencyInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const cents = Number(digits) / 100;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents);
}

export function parseCurrencyInput(raw: string): number | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  return Number(digits) / 100;
}

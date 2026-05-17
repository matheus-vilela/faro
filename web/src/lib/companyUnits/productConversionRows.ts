import {
  getLockedSystemSecondaryQty,
  isLockedSystemConversionPair,
} from "@/lib/companyUnits/convert";
import { SYSTEM_PRODUCT_UNITS } from "@/lib/companyUnits/systemUnits";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";

export function formatProductConversionQty(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1) {
    return n.toLocaleString("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    });
  }
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  });
}

export function buildLockedProductConversionRows(
  companyId: string,
  stockUnitCode: string,
): ProductUnitConversionDraft[] {
  const out: ProductUnitConversionDraft[] = [];
  const primary = stockUnitCode.trim();
  if (!primary) return out;
  for (const u of SYSTEM_PRODUCT_UNITS) {
    if (u.code.toLowerCase() === primary.toLowerCase()) continue;
    const secondaryQty = getLockedSystemSecondaryQty(1, primary, u.code);
    if (secondaryQty == null) continue;
    out.push({
      company_id: companyId,
      primary_qty: 1,
      primary_unit_code: primary,
      secondary_qty: secondaryQty,
      secondary_unit_code: u.code,
    });
  }
  return out;
}

export function buildProductConversionRowsToRender(
  companyId: string,
  stockUnitCode: string,
  customRows: ProductUnitConversionDraft[],
): ProductUnitConversionDraft[] {
  const lockedRows = buildLockedProductConversionRows(companyId, stockUnitCode);
  return [...lockedRows, ...customRows];
}

export function productConversionRowLabel(
  row: ProductUnitConversionDraft,
  stockUnitCode: string,
): string {
  const pri = SYSTEM_PRODUCT_UNITS.find(
    (u) => u.code.toLowerCase() === stockUnitCode.trim().toLowerCase(),
  );
  const sec = SYSTEM_PRODUCT_UNITS.find(
    (u) =>
      u.code.toLowerCase() === row.secondary_unit_code.trim().toLowerCase(),
  );
  return `${formatProductConversionQty(Number(row.primary_qty))} ${
    pri?.label ?? row.primary_unit_code
  } (${row.primary_unit_code}) = ${formatProductConversionQty(
    Number(row.secondary_qty),
  )} ${sec?.label ?? row.secondary_unit_code} (${row.secondary_unit_code})`;
}

export function isProductConversionRowLocked(
  row: ProductUnitConversionDraft,
): boolean {
  return isLockedSystemConversionPair(
    row.primary_unit_code,
    row.secondary_unit_code,
  );
}

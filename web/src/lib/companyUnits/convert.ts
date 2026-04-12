import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";

export type UnitConversionCodeRow = {
  primary_unit_code: string;
  secondary_unit_code: string;
  primary_qty: number;
  secondary_qty: number;
};

/**
 * Converte quantidade entre duas unidades usando o hub (unidade de estoque do produto) e regras por código.
 * Regra: primary_qty na unidade hub = secondary_qty na secundária.
 */
export function convertQuantityWithHubCodes(
  qty: number,
  fromCode: string,
  toCode: string,
  hubCode: string,
  conversions: UnitConversionCodeRow[],
): number | null {
  const from = fromCode.trim().toLowerCase();
  const to = toCode.trim().toLowerCase();
  const hub = hubCode.trim().toLowerCase();
  if (from === to) return qty;
  if (!Number.isFinite(qty)) return null;

  const convForSecondary = (sec: string) =>
    conversions.find(
      (c) =>
        c.primary_unit_code.trim().toLowerCase() === hub &&
        c.secondary_unit_code.trim().toLowerCase() === sec,
    );

  const toHubQty = (q: number, unitCode: string): number | null => {
    const u = unitCode.trim().toLowerCase();
    if (u === hub) return q;
    const conv = convForSecondary(u);
    if (!conv) return null;
    return q * (Number(conv.primary_qty) / Number(conv.secondary_qty));
  };

  const fromHubQty = (q: number, unitCode: string): number | null => {
    const u = unitCode.trim().toLowerCase();
    if (u === hub) return q;
    const conv = convForSecondary(u);
    if (!conv) return null;
    return q * (Number(conv.secondary_qty) / Number(conv.primary_qty));
  };

  const qp = toHubQty(qty, from);
  if (qp == null || Number.isNaN(qp)) return null;
  return fromHubQty(qp, to);
}

/** Alias: hub = unidade de estoque do produto (`products.unit`). */
export function convertQuantityForProduct(
  qty: number,
  fromCode: string,
  toCode: string,
  productUnitCode: string,
  productConversions: UnitConversionCodeRow[],
): number | null {
  return convertQuantityWithHubCodes(
    qty,
    fromCode,
    toCode,
    productUnitCode,
    productConversions,
  );
}

export function formatUnitLabelFromCodes(code: string): string {
  return `${systemUnitLabel(code)} (${code})`;
}

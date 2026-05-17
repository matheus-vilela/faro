import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";

export type UnitConversionCodeRow = {
  primary_unit_code: string;
  secondary_unit_code: string;
  primary_qty: number;
  secondary_qty: number;
};

const UNIT_DIMENSIONS = {
  mg: { dimension: "mass", baseFactor: 1 },
  g: { dimension: "mass", baseFactor: 1000 },
  kg: { dimension: "mass", baseFactor: 1000 * 1000 },
  ml: { dimension: "volume", baseFactor: 1 },
  l: { dimension: "volume", baseFactor: 1000 },
} as const;

const MASS_UNIT_CODES = ["mg", "g", "kg"] as const;
const VOLUME_UNIT_CODES = ["ml", "l"] as const;

function systemRatio(fromCode: string, toCode: string): number | null {
  const from = UNIT_DIMENSIONS[fromCode as keyof typeof UNIT_DIMENSIONS];
  const to = UNIT_DIMENSIONS[toCode as keyof typeof UNIT_DIMENSIONS];
  if (!from || !to) return null;
  if (from.dimension !== to.dimension) return null;
  return from.baseFactor / to.baseFactor;
}

export function isLockedSystemConversionPair(
  primaryUnitCode: string,
  secondaryUnitCode: string,
): boolean {
  return (
    systemRatio(primaryUnitCode.trim().toLowerCase(), secondaryUnitCode.trim().toLowerCase()) !=
    null
  );
}

/**
 * Ao cadastrar conversão para kg/g/mg (ou ml/l), gera as equivalentes na mesma família.
 * Não substitui regras já existentes nem pares travados pelo sistema (ex.: hub kg → g).
 */
export function expandMassVolumeConversionSiblings(
  hubCode: string,
  rows: UnitConversionCodeRow[],
): UnitConversionCodeRow[] {
  const hubNorm = hubCode.trim().toLowerCase();
  if (!hubNorm) return rows;

  const bySecondary = new Map<string, UnitConversionCodeRow>();
  for (const r of rows) {
    if (r.primary_unit_code.trim().toLowerCase() !== hubNorm) continue;
    bySecondary.set(r.secondary_unit_code.trim().toLowerCase(), r);
  }

  const out = [...rows];

  const deriveFamily = (
    source: UnitConversionCodeRow,
    family: readonly string[],
  ) => {
    const sec = source.secondary_unit_code.trim().toLowerCase();
    if (!family.includes(sec)) return;

    for (const target of family) {
      if (target === sec) continue;
      if (bySecondary.has(target)) continue;
      if (isLockedSystemConversionPair(hubNorm, target)) continue;

      const ratio = systemRatio(sec, target);
      if (ratio == null || !Number.isFinite(ratio)) continue;

      const derived: UnitConversionCodeRow = {
        primary_unit_code: source.primary_unit_code,
        primary_qty: source.primary_qty,
        secondary_unit_code: target,
        secondary_qty: source.secondary_qty * ratio,
      };
      out.push(derived);
      bySecondary.set(target, derived);
    }
  };

  const snapshot = rows.filter(
    (r) => r.primary_unit_code.trim().toLowerCase() === hubNorm,
  );
  for (const r of snapshot) {
    deriveFamily(r, MASS_UNIT_CODES);
  }
  for (const r of snapshot) {
    deriveFamily(r, VOLUME_UNIT_CODES);
  }

  return out.sort((a, b) =>
    a.secondary_unit_code.localeCompare(b.secondary_unit_code, "pt-BR"),
  );
}

export function getLockedSystemSecondaryQty(
  primaryQty: number,
  primaryUnitCode: string,
  secondaryUnitCode: string,
): number | null {
  if (!Number.isFinite(primaryQty) || primaryQty <= 0) return null;
  const ratio = systemRatio(
    primaryUnitCode.trim().toLowerCase(),
    secondaryUnitCode.trim().toLowerCase(),
  );
  if (ratio == null) return null;
  return primaryQty * ratio;
}

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

  const locked = systemRatio(from, to);
  if (locked != null) return qty * locked;

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

/**
 * Converte um valor monetário "por unidade" preservando o valor total.
 * Ex.: 25 por un com 1 un = 300 g -> 0.083333... por g.
 */
export function convertUnitPriceForProduct(
  valuePerFromUnit: number,
  fromCode: string,
  toCode: string,
  productUnitCode: string,
  productConversions: UnitConversionCodeRow[],
): number | null {
  if (!Number.isFinite(valuePerFromUnit)) return null;
  const factor = convertQuantityWithHubCodes(
    1,
    toCode,
    fromCode,
    productUnitCode,
    productConversions,
  );
  if (factor == null || !Number.isFinite(factor)) return null;
  return valuePerFromUnit * factor;
}

export function formatUnitLabelFromCodes(code: string): string {
  return `${systemUnitLabel(code)} (${code})`;
}

export function rebaseProductConversionsToHub(
  conversions: UnitConversionCodeRow[],
  prevHubCode: string,
  nextHubCode: string,
): UnitConversionCodeRow[] {
  const prevHub = prevHubCode.trim();
  const nextHub = nextHubCode.trim();
  if (!prevHub || !nextHub) return [];
  if (prevHub.toLowerCase() === nextHub.toLowerCase()) return [...conversions];

  const unitSet = new Set<string>();
  unitSet.add(prevHub);
  for (const c of conversions) {
    unitSet.add(c.secondary_unit_code.trim());
  }

  const rowToNext = conversions.find(
    (c) =>
      c.primary_unit_code.trim().toLowerCase() === prevHub.toLowerCase() &&
      c.secondary_unit_code.trim().toLowerCase() === nextHub.toLowerCase(),
  );
  const rebased: UnitConversionCodeRow[] = [];
  for (const unitCode of unitSet) {
    const normalizedUnit = unitCode.trim();
    if (!normalizedUnit) continue;
    if (normalizedUnit.toLowerCase() === nextHub.toLowerCase()) continue;
    if (isLockedSystemConversionPair(nextHub, normalizedUnit)) continue;
    if (
      rowToNext &&
      normalizedUnit.toLowerCase() === prevHub.toLowerCase()
    ) {
      const c = Number(rowToNext.primary_qty);
      const d = Number(rowToNext.secondary_qty);
      if (Number.isFinite(c) && Number.isFinite(d) && c > 0 && d > 0) {
        rebased.push({
          primary_unit_code: nextHub,
          secondary_unit_code: normalizedUnit,
          primary_qty: d,
          secondary_qty: c,
        });
        continue;
      }
    }
    const rowToUnit = conversions.find(
      (c) =>
        c.primary_unit_code.trim().toLowerCase() === prevHub.toLowerCase() &&
        c.secondary_unit_code.trim().toLowerCase() === normalizedUnit.toLowerCase(),
    );

    // Quando a nova base é uma secundária da base anterior, preservamos a razão
    // por multiplicação de proporções para evitar deriva numérica por casas decimais.
    if (rowToNext && rowToUnit) {
      const c = Number(rowToNext.primary_qty);
      const d = Number(rowToNext.secondary_qty);
      const a = Number(rowToUnit.primary_qty);
      const b = Number(rowToUnit.secondary_qty);
      if (
        Number.isFinite(c) &&
        Number.isFinite(d) &&
        Number.isFinite(a) &&
        Number.isFinite(b) &&
        c > 0 &&
        d > 0 &&
        a > 0 &&
        b > 0
      ) {
        rebased.push({
          primary_unit_code: nextHub,
          secondary_unit_code: normalizedUnit,
          primary_qty: d * a,
          secondary_qty: c * b,
        });
        continue;
      }
    }

    const qtyInSecondary = convertQuantityWithHubCodes(
      1,
      nextHub,
      normalizedUnit,
      prevHub,
      conversions,
    );
    if (
      qtyInSecondary == null ||
      !Number.isFinite(qtyInSecondary) ||
      qtyInSecondary <= 0
    ) {
      continue;
    }
    rebased.push({
      primary_unit_code: nextHub,
      secondary_unit_code: normalizedUnit,
      primary_qty: 1,
      secondary_qty: qtyInSecondary,
    });
  }

  return rebased.sort((a, b) =>
    a.secondary_unit_code.localeCompare(b.secondary_unit_code, "pt-BR"),
  );
}

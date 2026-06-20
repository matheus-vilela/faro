import {
  convertQuantityForProduct,
  normalizeProductConversionRowsToPrimaryOne,
  type UnitConversionCodeRow,
  rebaseProductConversionsToHub,
} from "@/lib/companyUnits/convert";
import { roundHubQuantityForStock } from "@/lib/productQuantityInput";

/** Modelo alinhado ao motor de preview NF-e: 1 UN contável = 100 g. */
export const UN_PACK_GRAMS_PER_COUNTABLE_UN = 100;
/** Modelo alinhado ao motor de preview NF-e: 1 UN contável = 100 ml. */
export const UN_PACK_ML_PER_COUNTABLE_UN = 100;

function norm(u: string) {
  return u.trim().toLowerCase();
}

function isMassCode(u: string) {
  const x = norm(u);
  return x === "mg" || x === "g" || x === "kg";
}

function isVolumeCode(u: string) {
  const x = norm(u);
  return x === "ml" || x === "l";
}

export type UnPackDimension = "mass" | "volume";

function oldHubHasSecondaryDimension(
  oldHub: string,
  convs: UnitConversionCodeRow[],
  kind: "mass" | "volume",
): boolean {
  const o = norm(oldHub);
  return convs.some((c) => {
    if (norm(c.primary_unit_code) !== o) return false;
    const sec = norm(c.secondary_unit_code);
    return kind === "volume" ? isVolumeCode(sec) : isMassCode(sec);
  });
}

function rebasedUnHasSecondaryDimension(
  rebased: UnitConversionCodeRow[],
  kind: "mass" | "volume",
): boolean {
  return rebased.some((c) => {
    if (norm(c.primary_unit_code) !== "un") return false;
    const sec = norm(c.secondary_unit_code);
    return kind === "volume" ? isVolumeCode(sec) : isMassCode(sec);
  });
}

/** Decide se o “pacote” da UN é massa ou volume (fallback só quando não há conversão cadastrada). */
export function inferUnPackDimension(
  oldHub: string,
  convsForOldHub: UnitConversionCodeRow[],
): UnPackDimension {
  const o = norm(oldHub);
  const vol =
    isVolumeCode(o) ||
    oldHubHasSecondaryDimension(o, convsForOldHub, "volume");
  const mass =
    isMassCode(o) || oldHubHasSecondaryDimension(o, convsForOldHub, "mass");
  if (vol && !mass) return "volume";
  if (mass && !vol) return "mass";
  if (vol && mass) return "volume";
  if (o === "un") {
    const hasMl = convsForOldHub.some(
      (c) =>
        norm(c.primary_unit_code) === "un" &&
        norm(c.secondary_unit_code) === "ml",
    );
    const hasG = convsForOldHub.some(
      (c) =>
        norm(c.primary_unit_code) === "un" &&
        norm(c.secondary_unit_code) === "g",
    );
    if (hasMl && !hasG) return "volume";
    return "mass";
  }
  return "mass";
}

function gramsPerUnFromConvs(convs: UnitConversionCodeRow[], hub: string): number {
  const h = norm(hub);
  if (h !== "un") return UN_PACK_GRAMS_PER_COUNTABLE_UN;
  const row = convs.find(
    (c) => norm(c.primary_unit_code) === "un" && norm(c.secondary_unit_code) === "g",
  );
  if (!row || !Number.isFinite(Number(row.primary_qty)) || !Number.isFinite(Number(row.secondary_qty)))
    return UN_PACK_GRAMS_PER_COUNTABLE_UN;
  const p = Number(row.primary_qty);
  const s = Number(row.secondary_qty);
  if (p <= 0 || s <= 0) return UN_PACK_GRAMS_PER_COUNTABLE_UN;
  return s / p;
}

function mlPerUnFromConvs(convs: UnitConversionCodeRow[], hub: string): number {
  const h = norm(hub);
  if (h !== "un") return UN_PACK_ML_PER_COUNTABLE_UN;
  const row = convs.find(
    (c) => norm(c.primary_unit_code) === "un" && norm(c.secondary_unit_code) === "ml",
  );
  if (!row || !Number.isFinite(Number(row.primary_qty)) || !Number.isFinite(Number(row.secondary_qty)))
    return UN_PACK_ML_PER_COUNTABLE_UN;
  const p = Number(row.primary_qty);
  const s = Number(row.secondary_qty);
  if (p <= 0 || s <= 0) return UN_PACK_ML_PER_COUNTABLE_UN;
  return s / p;
}

function toGrams(
  qty: number,
  unit: string,
  stockHub: string,
  convs: UnitConversionCodeRow[],
): number | null {
  if (!Number.isFinite(qty)) return null;
  const u = norm(unit);
  const h = norm(stockHub);
  if (u === "mg") return qty / 1000;
  if (u === "g") return qty;
  if (u === "kg") return qty * 1000;
  if (u === h && u === "un") return qty * gramsPerUnFromConvs(convs, h);
  return null;
}

function fromGrams(
  grams: number,
  unit: string,
  stockHub: string,
  convs: UnitConversionCodeRow[],
): number | null {
  if (!Number.isFinite(grams)) return null;
  const u = norm(unit);
  const h = norm(stockHub);
  if (u === "mg") return grams * 1000;
  if (u === "g") return grams;
  if (u === "kg") return grams / 1000;
  if (u === h && u === "un") return grams / gramsPerUnFromConvs(convs, h);
  return null;
}

function toMl(
  qty: number,
  unit: string,
  stockHub: string,
  convs: UnitConversionCodeRow[],
): number | null {
  if (!Number.isFinite(qty)) return null;
  const u = norm(unit);
  const h = norm(stockHub);
  if (u === "ml") return qty;
  if (u === "l") return qty * 1000;
  if (u === h && u === "un") return qty * mlPerUnFromConvs(convs, h);
  return null;
}

function fromMl(
  ml: number,
  unit: string,
  stockHub: string,
  convs: UnitConversionCodeRow[],
): number | null {
  if (!Number.isFinite(ml)) return null;
  const u = norm(unit);
  const h = norm(stockHub);
  if (u === "ml") return ml;
  if (u === "l") return ml / 1000;
  if (u === h && u === "un") return ml / mlPerUnFromConvs(convs, h);
  return null;
}

/**
 * Reaproveita rebasing. Para hub `un`, só aplica 1 UN = 100 g/ml (modelo NF-e)
 * quando não existir conversão de massa/volume já derivada do cadastro.
 */
export function buildNextConversionsAfterHubChange(
  existing: UnitConversionCodeRow[],
  oldHub: string,
  newHub: string,
): UnitConversionCodeRow[] {
  const nextHub = norm(newHub);
  let next = rebaseProductConversionsToHub(existing, oldHub, newHub);
  if (nextHub !== "un") return next;

  const hasVolumeFromCadastro = rebasedUnHasSecondaryDimension(next, "volume");
  const hasMassFromCadastro = rebasedUnHasSecondaryDimension(next, "mass");

  if (hasVolumeFromCadastro || hasMassFromCadastro) {
    return normalizeProductConversionRowsToPrimaryOne(next, nextHub).sort(
      (a, b) =>
        a.secondary_unit_code.localeCompare(b.secondary_unit_code, "pt-BR"),
    );
  }

  const dim = inferUnPackDimension(oldHub, existing);
  if (dim === "mass") {
    next.push({
      primary_unit_code: "un",
      primary_qty: 1,
      secondary_qty: UN_PACK_GRAMS_PER_COUNTABLE_UN,
      secondary_unit_code: "g",
    });
  } else {
    next.push({
      primary_unit_code: "un",
      primary_qty: 1,
      secondary_qty: UN_PACK_ML_PER_COUNTABLE_UN,
      secondary_unit_code: "ml",
    });
  }

  return normalizeProductConversionRowsToPrimaryOne(next, nextHub).sort((a, b) =>
    a.secondary_unit_code.localeCompare(b.secondary_unit_code, "pt-BR"),
  );
}

/**
 * Converte quantidade de estoque ao mudar a unidade de referência do produto,
 * incluindo ponte por gramas (massa) ou ml (volume) com o modelo 1 UN = 100 g/ml.
 */
export function computeStockQuantityAfterHubChange(
  qty: number,
  oldHub: string,
  newHub: string,
  convsOldHub: UnitConversionCodeRow[],
  nextConvsNewHub: UnitConversionCodeRow[],
): number | null {
  if (!Number.isFinite(qty)) return null;
  const o = norm(oldHub);
  const n = norm(newHub);
  if (o === n) return roundHubQuantityForStock(qty);

  const direct = convertQuantityForProduct(qty, o, n, n, nextConvsNewHub);
  if (direct != null && Number.isFinite(direct)) return roundHubQuantityForStock(direct);

  const g0 = toGrams(qty, o, o, convsOldHub);
  const g1 = g0 != null ? fromGrams(g0, n, n, nextConvsNewHub) : null;
  if (g0 != null && g1 != null) return roundHubQuantityForStock(g1);

  const m0 = toMl(qty, o, o, convsOldHub);
  const m1 = m0 != null ? fromMl(m0, n, n, nextConvsNewHub) : null;
  if (m0 != null && m1 != null) return roundHubQuantityForStock(m1);

  return null;
}

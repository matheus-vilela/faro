/**
 * Normalização de unidades de medida para comparação e decisão de compatibilidade.
 * Regras de negócio: não converter silenciosamente entre famílias diferentes.
 */

export type NormalizedUnitCode =
  | "UND"
  | "MG"
  | "KG"
  | "G"
  | "L"
  | "ML"
  | "CX"
  | "SACHE"
  | "M"
  | "M2"
  | "M3"
  | "UNKN"

/** Famílias para checagem de conversão “segura” (ainda assim exige confirmação humana se unidades normalizadas forem diferentes). */
export const UNIT_FAMILY_WEIGHT: Record<NormalizedUnitCode, string> = {
  UND: "count",
  MG: "mass",
  KG: "mass",
  G: "mass",
  L: "volume",
  ML: "volume",
  CX: "count",
  SACHE: "count",
  M: "length",
  M2: "area",
  M3: "volume",
  UNKN: "unknown",
}

const RAW_ALIASES: Array<{ re: RegExp; code: NormalizedUnitCode }> = [
  { re: /^(und|un|uni|unid|unit|pc|peca|peça|pt)$/i, code: "UND" },
  { re: /^(mg|miligramas?|miligram|milligrams?)$/i, code: "MG" },
  { re: /^(kg|kgs|quilo|kilos?)$/i, code: "KG" },
  { re: /^(g|gr|grama|gramas)$/i, code: "G" },
  { re: /^(l|lt|litro|litros)$/i, code: "L" },
  { re: /^(ml|mililitro|mililitros)$/i, code: "ML" },
  { re: /^(cx|caixa|caixas)$/i, code: "CX" },
  {
    re: /^(sc|sache|sach[eê]|saches|envelope)$/i,
    code: "SACHE",
  },
  { re: /^(m|metro|metros)$/i, code: "M" },
  { re: /^(m2|m²)$/i, code: "M2" },
  { re: /^(m3|m³)$/i, code: "M3" },
]

function stripNoise(raw: string): string {
  return raw
    .trim()
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/\s+/g, " ")
}

/** Chave alinhada a `normalize_unit_alias_text` (Postgres): só a-z0-9. */
export function normalizeUnitAliasKey(raw: string | null | undefined): string {
  if (raw == null) return "";
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Se o rótulo da nota bater com alias da empresa, devolve `unit_code` do cadastro;
 * caso contrário devolve o texto original trimado.
 */
export function applyCompanyUnitAlias(
  raw: string | null | undefined,
  aliasNormKeyToUnitCode: Map<string, string>,
): string | null {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!t) return null;
  const key = normalizeUnitAliasKey(t);
  if (key && aliasNormKeyToUnitCode.has(key)) {
    return aliasNormKeyToUnitCode.get(key)!.trim();
  }
  return t;
}

/** Normaliza texto de unidade vindo da nota ou do cadastro. */
export function normalizeUnitLabel(raw: string | null | undefined): NormalizedUnitCode {
  if (raw == null) return "UNKN"
  const t = stripNoise(raw).toLowerCase()
  if (!t) return "UNKN"
  const ascii = t
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
  for (const { re, code } of RAW_ALIASES) {
    if (re.test(ascii)) return code
  }
  return "UNKN"
}

/** Mesma unidade normalizada. */
export function unitsAreEqual(a: NormalizedUnitCode, b: NormalizedUnitCode): boolean {
  return a !== "UNKN" && b !== "UNKN" && a === b
}

/**
 * Indica se duas unidades pertencem a uma família onde existe conversão numérica conhecida (ex.: kg↔g).
 * Isso NÃO autoriza conversão automática no vínculo — só informa UI / pendência.
 */
export function unitsAreConvertible(a: NormalizedUnitCode, b: NormalizedUnitCode): boolean {
  if (a === "UNKN" || b === "UNKN") return false
  if (a === b) return true
  const mass = new Set<NormalizedUnitCode>(["MG", "KG", "G"])
  const vol = new Set<NormalizedUnitCode>(["L", "ML"])
  if (mass.has(a) && mass.has(b)) return true
  if (vol.has(a) && vol.has(b)) return true
  return false
}

/** Fator para expressar `quantityInB` em unidades de `a` quando conversível (massa/volume). */
export function conversionFactorToA(
  a: NormalizedUnitCode,
  b: NormalizedUnitCode,
): number | null {
  if (a === b) return 1
  if (a === "G" && b === "MG") return 0.001
  if (a === "MG" && b === "G") return 1000
  if (a === "KG" && b === "G") return 0.001
  if (a === "G" && b === "KG") return 1000
  if (a === "KG" && b === "MG") return 0.000001
  if (a === "MG" && b === "KG") return 1000000
  if (a === "L" && b === "ML") return 0.001
  if (a === "ML" && b === "L") return 1000
  return null
}

/**
 * Catálogo fixo de unidades do produto (código interno + rótulo em pt-BR).
 * Todos os selects de unidade devem usar apenas estes códigos.
 */
export type SystemProductUnit = {
  code: string;
  label: string;
  /** Ordem de exibição (menor primeiro). */
  sortOrder: number;
};

export const SYSTEM_PRODUCT_UNITS: readonly SystemProductUnit[] = [
  { code: "mg", label: "Miligrama", sortOrder: 0 },
  { code: "g", label: "Grama", sortOrder: 1 },
  { code: "kg", label: "Quilograma", sortOrder: 2 },
  { code: "ml", label: "Mililitro", sortOrder: 3 },
  { code: "l", label: "Litro", sortOrder: 4 },
  { code: "lata", label: "Lata", sortOrder: 5 },
  { code: "un", label: "Unidade", sortOrder: 6 },
  { code: "cx", label: "Caixa", sortOrder: 7 },
  { code: "pc", label: "Peça", sortOrder: 8 },
  { code: "garrafa", label: "Garrafa", sortOrder: 9 },
  { code: "frasco", label: "Frasco", sortOrder: 10 },
  { code: "galao", label: "Galão", sortOrder: 11 },
  { code: "pote", label: "Pote", sortOrder: 12 },
  { code: "rolo", label: "Rolo", sortOrder: 13 },
  { code: "pct", label: "Pacote", sortOrder: 14 },
  { code: "saco", label: "Saco", sortOrder: 15 },
  { code: "barrica", label: "Barrica", sortOrder: 16 },
  { code: "tambor", label: "Tambor", sortOrder: 17 },
  { code: "fardo", label: "Fardo", sortOrder: 18 },
  { code: "fd", label: "Fardo (sigla)", sortOrder: 18 },
  { code: "bisnaga", label: "Bisnaga", sortOrder: 19 },
  { code: "maco", label: "Maço", sortOrder: 20 },
  { code: "bandeja", label: "Bandeja", sortOrder: 21 },
] as const;

const CODE_SET = new Set(
  SYSTEM_PRODUCT_UNITS.map((u) => u.code.toLowerCase()),
);

const LABEL_BY_CODE = new Map(
  SYSTEM_PRODUCT_UNITS.map((u) => [u.code.toLowerCase(), u.label] as const),
);

export function isSystemUnitCode(code: string | undefined | null): boolean {
  if (code == null || code === "") return false;
  return CODE_SET.has(code.trim().toLowerCase());
}

/** Rótulo amigável para exibição; se não for do catálogo, devolve o código. */
export function systemUnitLabel(code: string | undefined | null): string {
  if (code == null || code === "") return "—";
  const key = code.trim().toLowerCase();
  return LABEL_BY_CODE.get(key) ?? code;
}

export function getSystemProductUnitSelectOptions(): {
  value: string;
  label: string;
}[] {
  return [...SYSTEM_PRODUCT_UNITS]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((u) => ({ value: u.code, label: `${u.label} (${u.code})` }));
}

/**
 * Opções do select + item extra quando o produto ainda usa código fora do catálogo (legado).
 */
export function getSystemProductUnitSelectOptionsWithLegacy(
  currentUnit: string | undefined | null,
): { value: string; label: string }[] {
  const base = getSystemProductUnitSelectOptions();
  const raw = (currentUnit ?? "").trim();
  if (!raw) return base;
  if (isSystemUnitCode(raw)) return base;
  return [{ value: raw, label: `${raw} (legado — altere para uma unidade do sistema)` }, ...base];
}

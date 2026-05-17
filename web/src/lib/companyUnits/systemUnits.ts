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
  { code: "fd", label: "Fardo", sortOrder: 18 },
  { code: "bisnaga", label: "Bisnaga", sortOrder: 19 },
  { code: "maco", label: "Maço", sortOrder: 20 },
  { code: "bandeja", label: "Bandeja", sortOrder: 21 },
] as const;

const CODE_SET = new Set(SYSTEM_PRODUCT_UNITS.map((u) => u.code.toLowerCase()));

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
 * Opções do select + item extra quando o produto ainda usa código fora do catálogo
 * (importação, XML, dados antigos).
 */
export function getSystemProductUnitSelectOptionsWithLegacy(
  currentUnit: string | undefined | null,
): { value: string; label: string }[] {
  const base = getSystemProductUnitSelectOptions();
  const raw = (currentUnit ?? "").trim();
  if (!raw) return base;
  if (isSystemUnitCode(raw)) return base;
  return [
    {
      value: raw,
      label: `${raw} — fora do catálogo: escolha abaixo ou crie a unidade.`,
    },
    ...base,
  ];
}

export type CompanyUnitAliasRow = { unit_code: string; unit_label: string };

/** Unidade do catálogo (sistema) ou unidade personalizada da empresa. */
export function isUnitInCompanyCatalog(
  unit: string | null | undefined,
  customUnitAliasOptions: ReadonlyArray<CompanyUnitAliasRow>,
): boolean {
  const u = (unit ?? "").trim();
  if (!u) return true;
  if (isSystemUnitCode(u)) return true;
  return customUnitAliasOptions.some(
    (a) => a.unit_code.trim().toLowerCase() === u.toLowerCase(),
  );
}

/**
 * Sistema + unidades personalizadas da empresa; inclui a linha extra
 * (código atual fora do catálogo) quando a unidade do produto ainda não bate
 * com nenhum código conhecido.
 */
export function buildProductUnitSelectOptions(
  currentUnit: string | undefined | null,
  customUnitAliasOptions: ReadonlyArray<CompanyUnitAliasRow>,
): { value: string; label: string }[] {
  const base = getSystemProductUnitSelectOptionsWithLegacy(currentUnit);
  if (!customUnitAliasOptions.length) return base;
  const customCodes = new Set(
    customUnitAliasOptions.map((u) => u.unit_code.trim().toLowerCase()),
  );
  const baseWithoutLegacyForCustom = base.filter(
    (x) =>
      !(
        customCodes.has(x.value.trim().toLowerCase()) &&
        !isSystemUnitCode(x.value)
      ),
  );
  const has = new Set(
    baseWithoutLegacyForCustom.map((x) => x.value.toLowerCase()),
  );
  const extra = customUnitAliasOptions
    .map((u) => ({
      value: u.unit_code.trim().toLowerCase(),
      label: `${u.unit_label} (${u.unit_code.trim().toLowerCase()})`,
    }))
    .filter((u) => u.value && !has.has(u.value));
  return [...baseWithoutLegacyForCustom, ...extra];
}

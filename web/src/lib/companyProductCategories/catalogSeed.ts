export type ProductCatalogDreKind = "variavel" | "administrativa";

export type ProductCatalogSeedRow = {
  name: string;
  sort_order: number;
  dreKind: ProductCatalogDreKind;
  excludeFromSales: boolean;
  composesCmv: boolean;
};

function row(
  name: string,
  sort_order: number,
  dreKind: ProductCatalogDreKind,
  opts?: { excludeFromSales?: boolean; composesCmv?: boolean },
): ProductCatalogSeedRow {
  const excludeFromSales = opts?.excludeFromSales === true;
  return {
    name,
    sort_order,
    dreKind,
    excludeFromSales,
    composesCmv: opts?.composesCmv ?? !excludeFromSales,
  };
}

/** Catálogo padrão (CMV da planilha + limpeza + Diversos). */
export const PRODUCT_CATALOG_SEED: readonly ProductCatalogSeedRow[] = [
  row("Hortifruti", 0, "variavel"),
  row("Salgados e Pré Prontos", 1, "variavel"),
  row("Congelados", 2, "variavel"),
  row("Laticínios/Frios", 3, "variavel"),
  row("Proteínas", 4, "variavel"),
  row("Não perecíveis", 5, "variavel"),
  row("Pães", 6, "variavel"),
  row("Sobremesas", 7, "variavel"),
  row("Mercado", 8, "variavel"),
  row("Carvão", 9, "variavel"),
  row("Gás", 10, "variavel", { excludeFromSales: true, composesCmv: false }),
  row("Coleta de óleo", 11, "variavel", {
    excludeFromSales: true,
    composesCmv: false,
  }),
  row("Destilados", 12, "variavel"),
  row("Cervejas", 13, "variavel"),
  row("Vinhos", 14, "variavel"),
  row("Soft Drink", 15, "variavel"),
  row("Gelo", 16, "variavel"),
  row("Utensílios Bar", 17, "variavel"),
  row("Insumos - Drinks", 18, "variavel"),
  row("Insumos - Bar", 19, "variavel"),
  row("Embalagens e descartáveis", 20, "variavel"),
  row("Produtos licenciados", 21, "variavel"),
  row("Material de Limpeza", 22, "administrativa", {
    excludeFromSales: true,
    composesCmv: false,
  }),
  row("Diversos", 23, "variavel"),
];

const BY_NAME = new Map(PRODUCT_CATALOG_SEED.map((r) => [r.name, r]));

export function catalogRowByName(name: string): ProductCatalogSeedRow | null {
  return BY_NAME.get(name) ?? null;
}

/** Gás, coleta de óleo e limpeza não entram no CMV de margens. */
export function catalogCategoryComposesCmv(name: string): boolean {
  const row = BY_NAME.get(name);
  if (row) return row.composesCmv;
  return true;
}

export function composesCmvFromCatalogNames(names: readonly string[]): boolean {
  if (names.length === 0) return true;
  return names.some((name) => catalogCategoryComposesCmv(name));
}

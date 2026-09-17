/** Mix operacional da venda: catálogo de produto, nunca folha DRE nem pagamento. */

export const SEM_GRUPO_LABEL = "Sem grupo";

export type CatalogMixCategory = {
  id: string;
  name: string;
  sort_order: number;
  exclude_from_sales?: boolean | null;
  ativo?: boolean | null;
};

export type CatalogMixSaleRef = {
  entry_mode?: string | null;
  product_id?: string | null;
  recipe_id?: string | null;
};

export function pickCatalogMixCategory(
  categories: readonly CatalogMixCategory[],
): CatalogMixCategory | null {
  const usable = categories.filter(
    (c) => c.ativo !== false && c.exclude_from_sales !== true,
  );
  if (usable.length === 0) return null;
  return [...usable].sort(
    (a, b) =>
      a.sort_order - b.sort_order ||
      a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
  )[0]!;
}

export function indexCatalogMixByProductId(
  rows: readonly {
    product_id: string;
    company_product_categories:
      | CatalogMixCategory
      | CatalogMixCategory[]
      | null;
  }[],
): Map<string, CatalogMixCategory[]> {
  const map = new Map<string, CatalogMixCategory[]>();
  for (const row of rows) {
    const raw = row.company_product_categories;
    const cat = Array.isArray(raw) ? raw[0] : raw;
    if (!cat) continue;
    const list = map.get(row.product_id);
    if (list) list.push(cat);
    else map.set(row.product_id, [cat]);
  }
  return map;
}

export function catalogProductIdForSale(
  entry: CatalogMixSaleRef,
  recipeOutputById: ReadonlyMap<string, string | null | undefined>,
): string | null {
  if (entry.entry_mode === "product_sale" && entry.product_id) {
    return entry.product_id;
  }
  if (entry.entry_mode === "recipe_sale" && entry.recipe_id) {
    return recipeOutputById.get(entry.recipe_id) ?? null;
  }
  return entry.product_id ?? null;
}

export function catalogMixLabelForProduct(
  productId: string | null | undefined,
  categoriesByProductId: ReadonlyMap<string, readonly CatalogMixCategory[]>,
): string {
  if (!productId) return SEM_GRUPO_LABEL;
  const picked = pickCatalogMixCategory(
    categoriesByProductId.get(productId) ?? [],
  );
  return picked?.name ?? SEM_GRUPO_LABEL;
}

export function catalogMixLabelForSale(
  entry: CatalogMixSaleRef,
  categoriesByProductId: ReadonlyMap<string, readonly CatalogMixCategory[]>,
  recipeOutputById: ReadonlyMap<string, string | null | undefined>,
): string {
  return catalogMixLabelForProduct(
    catalogProductIdForSale(entry, recipeOutputById),
    categoriesByProductId,
  );
}

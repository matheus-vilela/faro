export type RecipeListKindFilter = "all" | "sale" | "production";

export type RecipeListFilterRow = {
  name: string;
  recipe_type?: string | null;
  output_product_id?: string | null;
  recipe_ingredients?: Array<{
    products?: { name?: string | null } | null;
  } | null> | null;
};

export function recipeKindFilterValue(
  recipeType: string | null | undefined,
): "production" | "sale" {
  return recipeType === "PRODUCTION" ? "production" : "sale";
}

export function recipeCanBeProduced(
  recipeType: string | null | undefined,
): boolean {
  return recipeKindFilterValue(recipeType) === "production";
}

export function recipeMatchingIngredientNames(
  recipe: RecipeListFilterRow,
  query: string,
): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const ing of recipe.recipe_ingredients ?? []) {
    const name = (ing?.products?.name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    if (!key.includes(q)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export function recipeMatchesListFilters(
  recipe: RecipeListFilterRow,
  query: string,
  kind: RecipeListKindFilter,
  outputName?: string | null,
): boolean {
  if (kind !== "all" && recipeKindFilterValue(recipe.recipe_type) !== kind) {
    return false;
  }

  const q = query.trim().toLowerCase();
  if (!q) return true;

  if (recipe.name.toLowerCase().includes(q)) return true;
  if (outputName?.toLowerCase().includes(q)) return true;
  return recipeMatchingIngredientNames(recipe, query).length > 0;
}

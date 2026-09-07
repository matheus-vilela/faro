import { productUnitCost } from "@/lib/productCatalogValue";
import { recipeKindFilterValue } from "@/lib/recipeListFilter";
import type { Product } from "@/types/product";

export type RecipeSaleCmvIngredient = {
  product_id?: string | null;
  quantity?: number | null;
};

export type RecipeCmvNode = {
  id?: string;
  output_product_id?: string | null;
  recipe_type?: string | null;
  batch_yield?: number | null;
  recipe_ingredients?: Array<RecipeSaleCmvIngredient | null> | null;
};

/** Ficha normal (não produção) indexada pelo produto de saída. */
export function saleRecipesByOutputProductId(
  recipes: RecipeCmvNode[],
): Map<string, RecipeCmvNode> {
  const map = new Map<string, RecipeCmvNode>();
  for (const recipe of recipes) {
    if (recipeKindFilterValue(recipe.recipe_type) !== "sale") continue;
    const outputId = recipe.output_product_id?.trim();
    if (!outputId) continue;
    map.set(outputId, recipe);
  }
  return map;
}

/** Custo de 1 un. do produto: custo de estoque, ou CMV da ficha se o item for ficha. */
export function productCmvUnitCost(
  productId: string,
  unitCostByProductId: ReadonlyMap<string, number | null>,
  nestedByOutput: ReadonlyMap<string, RecipeCmvNode> = new Map(),
  visiting: ReadonlySet<string> = new Set(),
): number | null {
  const id = productId.trim();
  if (!id) return null;
  const nested = nestedByOutput.get(id);
  if (nested) {
    if (visiting.has(id)) return null;
    return recipeSaleCmv(
      nested,
      unitCostByProductId,
      nestedByOutput,
      visiting,
    );
  }
  const cost = unitCostByProductId.get(id);
  if (cost == null || !Number.isFinite(cost) || cost < 0) return null;
  return cost;
}

export function recipeIngredientCmv(
  stockQty: number,
  productId: string,
  unitCostByProductId: ReadonlyMap<string, number | null>,
  nestedByOutput: ReadonlyMap<string, RecipeCmvNode> = new Map(),
): number | null {
  if (!Number.isFinite(stockQty) || stockQty <= 0) return null;
  const unit = productCmvUnitCost(
    productId,
    unitCostByProductId,
    nestedByOutput,
  );
  if (unit == null) return null;
  return stockQty * unit;
}

/** CMV de 1 venda: insumos × custo / rendimento. Null se faltar custo. */
export function recipeSaleCmv(
  recipe: RecipeCmvNode,
  unitCostByProductId: ReadonlyMap<string, number | null>,
  nestedByOutput: ReadonlyMap<string, RecipeCmvNode> = new Map(),
  visiting: ReadonlySet<string> = new Set(),
): number | null {
  const outputId = recipe.output_product_id?.trim();
  const nextVisiting = new Set(visiting);
  if (outputId) {
    if (nextVisiting.has(outputId)) return null;
    nextVisiting.add(outputId);
  }

  const ings = recipe.recipe_ingredients ?? [];
  const yieldN = Number(recipe.batch_yield);
  const y = Number.isFinite(yieldN) && yieldN > 0 ? yieldN : 1;
  let total = 0;
  let used = 0;
  for (const ing of ings) {
    const qty = Number(ing?.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const id = (ing?.product_id ?? "").trim();
    if (!id) return null;
    const cost = productCmvUnitCost(
      id,
      unitCostByProductId,
      nestedByOutput,
      nextVisiting,
    );
    if (cost == null) return null;
    total += qty * cost;
    used += 1;
  }
  if (used === 0) return null;
  return total / y;
}

export function productUnitCostById(
  products: Array<
    Pick<
      Product,
      "id" | "average_cost" | "last_unit_value" | "last_unit_value_stock"
    >
  >,
): Map<string, number | null> {
  const map = new Map<string, number | null>();
  for (const p of products) {
    map.set(p.id, productUnitCost(p));
  }
  return map;
}

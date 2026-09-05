export type RecipeProductionIngredientInput = {
  productId: string;
  name: string;
  quantity: number;
  unitLabel: string;
};

export type RecipeProductionPreview = {
  batches: number;
  batchYield: number;
  outputQty: number;
  outputName: string;
  outputUnit: string;
  ingredients: RecipeProductionIngredientInput[];
};

export function parsePositiveQuantity(raw: string): number | null {
  const n = parseFloat(raw.replace(",", ".").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Receitas × rendimento = entrada; cada insumo da ficha × receitas = saída. */
export function recipeProductionPreview(args: {
  batchesRaw: string;
  batchYield: number;
  outputName: string;
  outputUnit: string;
  ingredients: RecipeProductionIngredientInput[];
}): RecipeProductionPreview | null {
  const batches = parsePositiveQuantity(args.batchesRaw);
  const yieldQty = Number(args.batchYield);
  if (batches == null || !Number.isFinite(yieldQty) || yieldQty <= 0) {
    return null;
  }
  return {
    batches,
    batchYield: yieldQty,
    outputQty: batches * yieldQty,
    outputName: args.outputName.trim() || "Produto",
    outputUnit: args.outputUnit.trim() || "un",
    ingredients: args.ingredients
      .filter((row) => row.quantity > 0)
      .map((row) => ({
        ...row,
        quantity: row.quantity * batches,
      })),
  };
}

export function formatProductionQty(value: number): string {
  return value.toLocaleString("pt-BR", {
    maximumFractionDigits: 6,
  });
}

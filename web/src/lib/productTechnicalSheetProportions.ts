/**
 * Quantidade de insumo (unidade de estoque) por saída do prato-pronto.
 * Alinhado a `consume_recipe_stock`: escala = saída_do_prato / batch_yield.
 */
export function ingredientOutQtyForOutputOut(
  outputOutQty: number,
  ingredientStockQtyPerPortion: number,
  batchYield: number,
): number {
  const out = Number(outputOutQty);
  const per = Number(ingredientStockQtyPerPortion);
  const yieldN = Number(batchYield);
  if (!Number.isFinite(out) || out <= 0) return 0;
  if (!Number.isFinite(per) || per <= 0) return 0;
  const y = Number.isFinite(yieldN) && yieldN > 0 ? yieldN : 1;
  return (out * per) / y;
}

/** Simula retroativo: N saídas de 1 un no prato → N saídas no insumo. */
export function backfillIngredientOutMovements(
  outputOutQuantities: number[],
  ingredientStockQtyPerPortion: number,
  batchYield = 1,
): number[] {
  return outputOutQuantities.map((q) =>
    ingredientOutQtyForOutputOut(q, ingredientStockQtyPerPortion, batchYield),
  );
}

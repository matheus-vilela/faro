import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

/** Espelha a fórmula SQL: need = mov.quantity * ri.quantity / batch_yield */
function ingredientOutQtyForOutputOut(
  outputOutQty: number,
  ingredientStockQtyPerPortion: number,
  batchYield: number,
): number {
  const y = batchYield > 0 ? batchYield : 1;
  return (outputOutQty * ingredientStockQtyPerPortion) / y;
}

Deno.test("10 saídas de 1 un no prato A → 10 saídas de 6 un no insumo B", () => {
  const outputOuts = Array.from({ length: 10 }, () => 1);
  const ingredientQtyPerPortion = 6;
  const ingredientOuts = outputOuts.map((q) =>
    ingredientOutQtyForOutputOut(q, ingredientQtyPerPortion, 1),
  );
  assertEquals(ingredientOuts.length, 10);
  assertEquals(ingredientOuts.every((x) => x === 6), true);
});

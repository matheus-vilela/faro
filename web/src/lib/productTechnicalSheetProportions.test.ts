import { describe, expect, it } from "vitest";
import {
  backfillIngredientOutMovements,
  ingredientOutQtyForOutputOut,
} from "./productTechnicalSheetProportions";

describe("productTechnicalSheetProportions", () => {
  it("1 prato vendido → 6 un do insumo B (proporção 1:6)", () => {
    expect(ingredientOutQtyForOutputOut(1, 6, 1)).toBe(6);
  });

  it("10 vendas de 1 un → 10 movimentações de 6 un no insumo", () => {
    const outs = Array.from({ length: 10 }, () => 1);
    const backfilled = backfillIngredientOutMovements(outs, 6, 1);
    expect(backfilled).toHaveLength(10);
    expect(backfilled.every((q) => q === 6)).toBe(true);
    expect(backfilled.reduce((s, q) => s + q, 0)).toBe(60);
  });

  it("respeita rendimento da ficha (batch_yield = 2)", () => {
    expect(ingredientOutQtyForOutputOut(2, 6, 2)).toBe(6);
  });

  it("saída fracionada do prato", () => {
    expect(ingredientOutQtyForOutputOut(0.5, 6, 1)).toBe(3);
  });
});

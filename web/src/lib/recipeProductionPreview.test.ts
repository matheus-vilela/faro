import { describe, expect, it } from "vitest";
import {
  recipeProductionPreview,
  parsePositiveQuantity,
} from "./recipeProductionPreview";

describe("recipeProductionPreview", () => {
  const ings = [
    { productId: "t", name: "Tomate", quantity: 2, unitLabel: "kg" },
    { productId: "s", name: "Sal", quantity: 0.01, unitLabel: "kg" },
  ];

  it("multiplica rendimento na entrada e insumos pelo número de receitas", () => {
    const preview = recipeProductionPreview({
      batchesRaw: "2",
      batchYield: 10,
      outputName: "Molho",
      outputUnit: "un",
      ingredients: ings,
    });
    expect(preview?.outputQty).toBe(20);
    expect(preview?.ingredients.map((i) => i.quantity)).toEqual([4, 0.02]);
  });

  it("rejeita quantidade inválida", () => {
    expect(
      recipeProductionPreview({
        batchesRaw: "0",
        batchYield: 10,
        outputName: "Molho",
        outputUnit: "un",
        ingredients: ings,
      }),
    ).toBeNull();
    expect(parsePositiveQuantity("abc")).toBeNull();
  });
});

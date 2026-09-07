import { describe, expect, it } from "vitest";
import {
  productCmvUnitCost,
  recipeIngredientCmv,
  recipeSaleCmv,
  saleRecipesByOutputProductId,
} from "./recipeSaleCmv";

describe("recipeSaleCmv", () => {
  const costs = new Map<string, number | null>([
    ["cachaca", 40],
    ["limao", 2],
  ]);

  it("soma insumos e divide pelo rendimento", () => {
    expect(
      recipeSaleCmv(
        {
          batch_yield: 1,
          recipe_ingredients: [
            { product_id: "cachaca", quantity: 0.05 },
            { product_id: "limao", quantity: 1 },
          ],
        },
        costs,
      ),
    ).toBeCloseTo(4, 6);
  });

  it("escala pelo rendimento do lote", () => {
    expect(
      recipeSaleCmv(
        {
          batch_yield: 2,
          recipe_ingredients: [{ product_id: "cachaca", quantity: 0.1 }],
        },
        costs,
      ),
    ).toBeCloseTo(2, 6);
  });

  it("fica vazio sem custo do insumo", () => {
    expect(
      recipeSaleCmv(
        {
          batch_yield: 1,
          recipe_ingredients: [{ product_id: "acucar", quantity: 1 }],
        },
        costs,
      ),
    ).toBeNull();
  });

  it("fica vazio sem insumos com quantidade", () => {
    expect(
      recipeSaleCmv({ batch_yield: 1, recipe_ingredients: [] }, costs),
    ).toBeNull();
  });

  it("explode ficha técnica usada como insumo", () => {
    const dose = {
      output_product_id: "ds-gin",
      recipe_type: "PREP",
      batch_yield: 1,
      recipe_ingredients: [{ product_id: "cachaca", quantity: 0.05 }],
    };
    const nested = saleRecipesByOutputProductId([dose]);
    expect(
      recipeSaleCmv(
        {
          output_product_id: "caipi",
          recipe_type: "PREP",
          batch_yield: 1,
          recipe_ingredients: [
            { product_id: "ds-gin", quantity: 1 },
            { product_id: "limao", quantity: 1 },
          ],
        },
        costs,
        nested,
      ),
    ).toBeCloseTo(4, 6);
  });

  it("não entra em ciclo entre fichas", () => {
    const a = {
      output_product_id: "a",
      recipe_type: "PREP",
      batch_yield: 1,
      recipe_ingredients: [{ product_id: "b", quantity: 1 }],
    };
    const b = {
      output_product_id: "b",
      recipe_type: "PREP",
      batch_yield: 1,
      recipe_ingredients: [{ product_id: "a", quantity: 1 }],
    };
    const nested = saleRecipesByOutputProductId([a, b]);
    expect(recipeSaleCmv(a, costs, nested)).toBeNull();
  });
});

describe("recipeIngredientCmv", () => {
  const costs = new Map<string, number | null>([["cachaca", 40]]);

  it("multiplica qtde de estoque pelo custo unitário", () => {
    expect(recipeIngredientCmv(0.05, "cachaca", costs)).toBeCloseTo(2, 6);
  });

  it("usa CMV da ficha filha", () => {
    const dose = {
      output_product_id: "ds-gin",
      recipe_type: "PREP",
      batch_yield: 1,
      recipe_ingredients: [{ product_id: "cachaca", quantity: 0.05 }],
    };
    expect(
      recipeIngredientCmv(
        2,
        "ds-gin",
        costs,
        saleRecipesByOutputProductId([dose]),
      ),
    ).toBeCloseTo(4, 6);
  });
});

describe("productCmvUnitCost", () => {
  it("cai no custo de estoque sem ficha", () => {
    expect(
      productCmvUnitCost("x", new Map([["x", 3]])),
    ).toBe(3);
  });
});

import { describe, expect, it } from "vitest";
import { recipeLineUnitIsAllowed } from "./CorrelationRecipeIngredientRow";

describe("recipeLineUnitIsAllowed", () => {
  it("aceita a unidade de estoque sem conversão extra", () => {
    expect(recipeLineUnitIsAllowed("un", "un", [])).toBe(true);
  });

  it("aceita ml quando o estoque é litro", () => {
    expect(recipeLineUnitIsAllowed("l", "ml", [])).toBe(true);
  });

  it("não aceita ml numa garrafa em un sem conversão", () => {
    expect(recipeLineUnitIsAllowed("un", "ml", [])).toBe(false);
  });

  it("aceita a unidade secundária cadastrada no insumo", () => {
    expect(
      recipeLineUnitIsAllowed("un", "ml", [
        {
          company_id: "c",
          product_id: "p",
          primary_qty: 1,
          primary_unit_code: "un",
          secondary_qty: 750,
          secondary_unit_code: "ml",
        },
      ]),
    ).toBe(true);
  });
});

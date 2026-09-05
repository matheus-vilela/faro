import { describe, expect, it } from "vitest";
import {
  recipeMatchingIngredientNames,
  recipeMatchesListFilters,
} from "./recipeListFilter";

const molho = {
  name: "Molho de tomate — produção",
  recipe_type: "PRODUCTION",
  output_product_id: "out",
  recipe_ingredients: [{ products: { name: "Tomate" } }],
};

const caipi = {
  name: "Caipirinha — ficha técnica",
  recipe_type: "PREP",
  recipe_ingredients: [
    { products: { name: "Cachaça" } },
    { products: { name: "Limão" } },
  ],
};

describe("recipeMatchesListFilters", () => {
  it("filtra pelo nome da ficha", () => {
    expect(recipeMatchesListFilters(molho, "molho", "all", "Molho")).toBe(true);
    expect(recipeMatchesListFilters(caipi, "molho", "all")).toBe(false);
  });

  it("filtra pelo insumo", () => {
    expect(recipeMatchesListFilters(caipi, "limão", "all")).toBe(true);
    expect(recipeMatchesListFilters(caipi, "tomate", "all")).toBe(false);
  });

  it("filtra pelo produto de saída", () => {
    expect(recipeMatchesListFilters(molho, "molho pronto", "all", "Molho pronto")).toBe(
      true,
    );
  });

  it("respeita o tipo", () => {
    expect(recipeMatchesListFilters(molho, "", "production")).toBe(true);
    expect(recipeMatchesListFilters(molho, "", "sale")).toBe(false);
    expect(recipeMatchesListFilters(caipi, "limão", "production")).toBe(false);
  });
});

describe("recipeMatchingIngredientNames", () => {
  it("devolve só o insumo que bate com a busca", () => {
    expect(recipeMatchingIngredientNames(caipi, "lim")).toEqual(["Limão"]);
    expect(recipeMatchingIngredientNames(caipi, "tomate")).toEqual([]);
    expect(recipeMatchingIngredientNames(caipi, "")).toEqual([]);
  });
});

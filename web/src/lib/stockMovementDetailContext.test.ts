import { describe, expect, it } from "vitest";
import {
  movementLineTotalCost,
  productStockRoleFromType,
  productStockRoleLabel,
  recipeKindLabel,
} from "@/lib/stockMovementDetailContext";

describe("productStockRoleFromType", () => {
  it("separa ficha, intermediário e produto", () => {
    expect(productStockRoleFromType("RECIPE_CONTROLLED")).toBe("recipe_sale");
    expect(productStockRoleFromType("INTERMEDIATE")).toBe("intermediate");
    expect(productStockRoleFromType("DIRECT")).toBe("direct");
    expect(productStockRoleFromType(null)).toBe("direct");
  });
});

describe("productStockRoleLabel", () => {
  it("usa os nomes do domínio", () => {
    expect(productStockRoleLabel("recipe_sale")).toBe("Ficha técnica");
    expect(productStockRoleLabel("intermediate")).toBe("Produto intermediário");
    expect(recipeKindLabel("production")).toBe("Ficha de produção");
    expect(recipeKindLabel("sale")).toBe("Ficha técnica");
  });
});

describe("movementLineTotalCost", () => {
  it("multiplica quantidade absoluta pelo custo", () => {
    expect(movementLineTotalCost(-2.5, 4)).toBe(10);
    expect(movementLineTotalCost(3, null)).toBeNull();
  });
});

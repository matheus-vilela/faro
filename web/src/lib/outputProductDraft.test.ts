import { describe, expect, it } from "vitest";
import {
  isPlaceholderRecipeName,
  matchProductByTypedName,
} from "./outputProductDraft";

const products = [
  { id: "1", name: "MOLHO DE TOMATE" },
  { id: "2", name: "Massa fresca" },
];

describe("matchProductByTypedName", () => {
  it("casa ignorando caixa e acento", () => {
    expect(matchProductByTypedName(products, "molho de tomate")?.id).toBe("1");
    expect(matchProductByTypedName(products, "MASSA FRESCA")?.id).toBe("2");
  });

  it("retorna null quando não há equivalente", () => {
    expect(matchProductByTypedName(products, "Molho pesto")).toBeNull();
    expect(matchProductByTypedName(products, "  ")).toBeNull();
  });
});

describe("isPlaceholderRecipeName", () => {
  it("reconhece nomes vazios e padrão da ficha", () => {
    expect(isPlaceholderRecipeName("")).toBe(true);
    expect(isPlaceholderRecipeName("Nova ficha técnica")).toBe(true);
    expect(isPlaceholderRecipeName("Caipirinha")).toBe(false);
  });
});

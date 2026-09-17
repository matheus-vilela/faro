import { describe, expect, it } from "vitest";
import { sanitizeCatalogProductName } from "@/lib/productImport/canonicalName";
import {
  catalogLastUnitValueChanged,
  catalogUnitCodesDiffer,
  parseCatalogStockQuantity,
} from "@/lib/catalogProductEdit";

describe("sanitizeCatalogProductName — asterisco no meio", () => {
  it("mantém *FLOR* em nome de granel", () => {
    expect(sanitizeCatalogProductName("CRAVO DA INDIA *FLOR* GRANEL")).toBe(
      "CRAVO DA INDIA *FLOR* GRANEL",
    );
  });
});

describe("catalogLastUnitValueChanged", () => {
  it("ignora casas além de centavos (preço de NF-e)", () => {
    expect(catalogLastUnitValueChanged(87.54, 87.54321)).toBe(false);
    expect(catalogLastUnitValueChanged(87.54, 87.54)).toBe(false);
  });

  it("detecta mudança real de centavos", () => {
    expect(catalogLastUnitValueChanged(87.55, 87.54321)).toBe(true);
    expect(catalogLastUnitValueChanged(null, 87.54)).toBe(true);
    expect(catalogLastUnitValueChanged(null, null)).toBe(false);
  });
});

describe("parseCatalogStockQuantity", () => {
  it("aceita saldo negativo", () => {
    expect(parseCatalogStockQuantity("-2.5")).toBe(-2.5);
    expect(parseCatalogStockQuantity("-2,5")).toBe(-2.5);
  });

  it("rejeita vazio ou texto", () => {
    expect(parseCatalogStockQuantity("")).toBeNull();
    expect(parseCatalogStockQuantity("abc")).toBeNull();
  });
});

describe("catalogUnitCodesDiffer", () => {
  it("ignora caixa e espaços", () => {
    expect(catalogUnitCodesDiffer("KG", "kg")).toBe(false);
    expect(catalogUnitCodesDiffer(" kg ", "KG")).toBe(false);
    expect(catalogUnitCodesDiffer("kg", "g")).toBe(true);
  });
});

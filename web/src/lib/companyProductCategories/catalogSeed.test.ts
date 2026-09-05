import { describe, expect, it } from "vitest";
import {
  catalogCategoryComposesCmv,
  composesCmvFromCatalogNames,
  PRODUCT_CATALOG_SEED,
} from "./catalogSeed";

describe("PRODUCT_CATALOG_SEED", () => {
  it("inclui CMV da planilha, limpeza e Diversos", () => {
    const names = PRODUCT_CATALOG_SEED.map((r) => r.name);
    expect(names).toContain("Hortifruti");
    expect(names).toContain("Cervejas");
    expect(names).toContain("Soft Drink");
    expect(names).toContain("Material de Limpeza");
    expect(names).toContain("Diversos");
    expect(names).not.toContain("Pagseguro");
    expect(
      PRODUCT_CATALOG_SEED.find((r) => r.name === "Material de Limpeza"),
    ).toMatchObject({
      dreKind: "administrativa",
      excludeFromSales: true,
      composesCmv: false,
    });
    expect(
      PRODUCT_CATALOG_SEED.find((r) => r.name === "Hortifruti"),
    ).toMatchObject({ dreKind: "variavel", composesCmv: true });
  });
});

describe("composesCmvFromCatalogNames", () => {
  it("Hortifruti e Cervejas nascem com CMV de margens", () => {
    expect(catalogCategoryComposesCmv("Hortifruti")).toBe(true);
    expect(catalogCategoryComposesCmv("Cervejas")).toBe(true);
    expect(composesCmvFromCatalogNames(["Hortifruti"])).toBe(true);
  });

  it("Gás, óleo e limpeza não compõem CMV", () => {
    expect(catalogCategoryComposesCmv("Gás")).toBe(false);
    expect(catalogCategoryComposesCmv("Coleta de óleo")).toBe(false);
    expect(catalogCategoryComposesCmv("Material de Limpeza")).toBe(false);
  });
});

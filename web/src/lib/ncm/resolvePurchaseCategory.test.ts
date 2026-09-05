import { describe, expect, it } from "vitest";
import { resolvePurchaseCategoryId } from "@/lib/ncm/resolvePurchaseCategory";

describe("resolvePurchaseCategoryId", () => {
  it("não sobrescreve categoria já definida na linha", () => {
    expect(
      resolvePurchaseCategoryId({
        existingCategoryId: "linha",
        productCategoryId: "produto",
        ncmCategoryId: "ncm",
      }),
    ).toBe("linha");
  });

  it("usa a regra de NCM antes da memória do produto", () => {
    expect(
      resolvePurchaseCategoryId({
        productCategoryId: "produto",
        ncmCategoryId: "ncm",
      }),
    ).toBe("ncm");
  });

  it("cai na memória do produto quando o NCM não tem regra", () => {
    expect(
      resolvePurchaseCategoryId({
        productCategoryId: "produto",
        ncmCategoryId: null,
      }),
    ).toBe("produto");
  });

  it("fica vazio quando ninguém definiu", () => {
    expect(resolvePurchaseCategoryId({})).toBeNull();
    expect(
      resolvePurchaseCategoryId({
        existingCategoryId: "  ",
        productCategoryId: "",
        ncmCategoryId: null,
      }),
    ).toBeNull();
  });
});

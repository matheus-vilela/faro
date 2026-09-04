import { describe, expect, it } from "vitest";
import {
  isPossibleGroupingProduct,
  isSaleFamilyCandidate,
  saleNameKeys,
  shouldShowPossibleSaleFamilyTag,
  type SaleFamilyProductOption,
} from "@/lib/productSaleFamily";

function product(
  extras: Partial<SaleFamilyProductOption> & { name: string },
): SaleFamilyProductOption {
  return {
    id: extras.id ?? extras.name,
    sku: extras.sku ?? null,
    stock_control_type: extras.stock_control_type ?? "DIRECT",
    name: extras.name,
  };
}

describe("isSaleFamilyCandidate", () => {
  const keys = saleNameKeys(["Bolinhos", "Água"]);

  it("aceita família de venda já marcada", () => {
    expect(
      isSaleFamilyCandidate(
        product({ name: "Outro", stock_control_type: "SALE_FAMILY" }),
        keys,
      ),
    ).toBe(true);
  });

  it("aceita item da venda do dia, ignorando maiúsculas", () => {
    expect(
      isSaleFamilyCandidate(product({ name: "BOLINHOS" }), keys),
    ).toBe(true);
  });

  it("rejeita ficha técnica mesmo se o nome estiver na venda", () => {
    expect(
      isSaleFamilyCandidate(
        product({ name: "Bolinhos", stock_control_type: "RECIPE_CONTROLLED" }),
        keys,
      ),
    ).toBe(false);
  });

  it("rejeita insumo que não está na venda", () => {
    expect(
      isSaleFamilyCandidate(product({ name: "Cachaça" }), keys),
    ).toBe(false);
  });
});

describe("shouldShowPossibleSaleFamilyTag", () => {
  const candidate = {
    stockControlType: "DIRECT",
    familyKind: "none" as const,
    hasOwnSale: false,
    seenInStockOuts: true,
  };

  it("marca só-estoque ainda sem vínculo", () => {
    expect(shouldShowPossibleSaleFamilyTag(candidate)).toBe(true);
  });

  it("omite água que também foi vendida", () => {
    expect(
      shouldShowPossibleSaleFamilyTag({ ...candidate, hasOwnSale: true }),
    ).toBe(false);
  });

  it("omite família e variante já ligadas", () => {
    expect(
      shouldShowPossibleSaleFamilyTag({
        ...candidate,
        stockControlType: "SALE_FAMILY",
      }),
    ).toBe(false);
    expect(
      shouldShowPossibleSaleFamilyTag({
        ...candidate,
        familyKind: "variant",
      }),
    ).toBe(false);
  });

  it("omite item marcado como não agrupamento", () => {
    expect(
      shouldShowPossibleSaleFamilyTag({
        ...candidate,
        notSaleGrouping: true,
      }),
    ).toBe(false);
  });
});

describe("isPossibleGroupingProduct", () => {
  it("marca só-estoque ainda sem decisão", () => {
    expect(
      isPossibleGroupingProduct({
        stock_control_type: "DIRECT",
        stock_only_origin: true,
      }),
    ).toBe(true);
  });

  it("omite item marcado como não agrupamento", () => {
    expect(
      isPossibleGroupingProduct({
        stock_control_type: "DIRECT",
        stock_only_origin: true,
        not_sale_grouping: true,
      }),
    ).toBe(false);
  });
});

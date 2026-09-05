import { describe, expect, it } from "vitest";
import {
  groupingDetailTitle,
  isPossibleGroupingProduct,
  isSaleFamilyCandidate,
  productGroupingRole,
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

  it("aceita agrupamento já marcado", () => {
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

  it("rejeita produto intermediário como agrupamento", () => {
    expect(
      isSaleFamilyCandidate(
        product({ name: "Bolinhos", stock_control_type: "INTERMEDIATE" }),
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

  it("omite agrupamento e variante já ligadas", () => {
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

  it("omite produto intermediário", () => {
    expect(
      isPossibleGroupingProduct({
        stock_control_type: "INTERMEDIATE",
        stock_only_origin: true,
      }),
    ).toBe(false);
  });
});

describe("productGroupingRole", () => {
  it("é agrupamento ou membro quando já está ligado", () => {
    expect(
      productGroupingRole({ isFamily: true, inGrouping: false }),
    ).toBe("self");
    expect(
      productGroupingRole({ isFamily: false, inGrouping: true }),
    ).toBe("member");
  });

  it("pede escolha quando é possível agrupamento e ainda não decidiu", () => {
    expect(
      productGroupingRole({
        isFamily: false,
        inGrouping: false,
        possibleGrouping: true,
        dismissed: false,
      }),
    ).toBe("");
  });

  it("mostra não é agrupamento no produto comum", () => {
    expect(
      productGroupingRole({ isFamily: false, inGrouping: false }),
    ).toBe("not_grouping");
  });
});

describe("groupingDetailTitle", () => {
  it("só rotula agrupamento e variante", () => {
    expect(groupingDetailTitle("family")).toBe("Agrupamento");
    expect(groupingDetailTitle("variant")).toBe("Faz parte de um agrupamento");
    expect(groupingDetailTitle("none")).toBeNull();
  });
});

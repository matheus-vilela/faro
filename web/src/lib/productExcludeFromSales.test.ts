import { describe, expect, it } from "vitest";
import {
  excludedProductIdsFromRows,
  filterRevenueEntriesAppearingAsSale,
  isProductExcludedFromSales,
  revenueEntryAppearsAsSale,
  sumRevenueCmvAppearingAsSale,
} from "@/lib/productExcludeFromSales";

describe("productExcludeFromSales", () => {
  it("marca produto só quando exclude_from_sales é true", () => {
    expect(isProductExcludedFromSales({ exclude_from_sales: true })).toBe(true);
    expect(isProductExcludedFromSales({ exclude_from_sales: false })).toBe(
      false,
    );
    expect(isProductExcludedFromSales({})).toBe(false);
    expect(isProductExcludedFromSales(null)).toBe(false);
  });

  it("coleta ids excluídos", () => {
    const ids = excludedProductIdsFromRows([
      { id: "a", exclude_from_sales: true },
      { id: "b", exclude_from_sales: false },
      { id: "c" },
    ]);
    expect([...ids]).toEqual(["a"]);
  });

  it("esconde product_sale de categoria não-venda e mantém o resto", () => {
    const excluded = new Set(["napkin"]);
    expect(
      revenueEntryAppearsAsSale(
        { entry_mode: "product_sale", product_id: "napkin" },
        excluded,
      ),
    ).toBe(false);
    expect(
      revenueEntryAppearsAsSale(
        { entry_mode: "product_sale", product_id: "beer" },
        excluded,
      ),
    ).toBe(true);
    expect(
      revenueEntryAppearsAsSale(
        { entry_mode: "recipe_sale", product_id: null },
        excluded,
      ),
    ).toBe(true);
    expect(
      revenueEntryAppearsAsSale(
        { entry_mode: "manual", product_id: "napkin" },
        excluded,
      ),
    ).toBe(true);
  });

  it("filtra lista e CMV sem contar o item excluído", () => {
    const excluded = new Set(["napkin"]);
    const rows = [
      {
        entry_mode: "product_sale",
        product_id: "napkin",
        cmv_amount: 10,
      },
      {
        entry_mode: "product_sale",
        product_id: "beer",
        cmv_amount: 40,
      },
    ];
    expect(filterRevenueEntriesAppearingAsSale(rows, excluded)).toHaveLength(1);
    expect(sumRevenueCmvAppearingAsSale(rows, excluded)).toBe(40);
  });
});

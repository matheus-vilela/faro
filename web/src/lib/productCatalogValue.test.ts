import { describe, expect, it } from "vitest";
import {
  productSaleUnitValue,
  productUnitCost,
} from "@/lib/productCatalogValue";

describe("productSaleUnitValue", () => {
  it("lê o preço de venda, não o de compra", () => {
    expect(
      productSaleUnitValue({ last_sale_unit_value: 18.5 }),
    ).toBe(18.5);
    expect(productSaleUnitValue({ last_sale_unit_value: null })).toBeNull();
    expect(productSaleUnitValue({ last_sale_unit_value: 0 })).toBeNull();
  });
});

describe("productUnitCost", () => {
  it("não usa o preço de venda", () => {
    expect(
      productUnitCost({
        average_cost: null,
        last_unit_value: 12,
        last_unit_value_stock: null,
      }),
    ).toBe(12);
  });
});

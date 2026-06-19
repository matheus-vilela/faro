import { describe, expect, it } from "vitest";
import { filterProductsForBatchPicker } from "./batchStockMovementPicker";
import type { BatchPickerProduct } from "./batchStockMovementPicker";

function p(
  id: string,
  name: string,
  categoryIds: string[] = [],
): BatchPickerProduct {
  return {
    id,
    name,
    categoryIds,
    company_id: "c1",
    sku: null,
    unit: "un",
    min_quantity: 0,
    current_quantity: 0,
    last_unit_value: null,
    created_at: "",
    updated_at: "",
  };
}

describe("batchStockMovementPicker", () => {
  const products = [
    p("1", "Arroz", ["cat-a"]),
    p("2", "Feijão", ["cat-b"]),
    p("3", "Sal", []),
  ];

  it("filters by search and category", () => {
    const out = filterProductsForBatchPicker(products, {
      search: "ar",
      categoryIds: ["cat-a"],
      supplierIds: [],
      productSupplierIds: new Map(),
    });
    expect(out.map((x) => x.id)).toEqual(["1"]);
  });

  it("filters by supplier when linked", () => {
    const map = new Map<string, string[]>([
      ["2", ["sup-1"]],
    ]);
    const out = filterProductsForBatchPicker(products, {
      search: "",
      categoryIds: [],
      supplierIds: ["sup-1"],
      productSupplierIds: map,
    });
    expect(out.map((x) => x.id)).toEqual(["2"]);
  });
});

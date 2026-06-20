import { describe, expect, it } from "vitest";
import { validateManualStockMovementInput } from "./manualStockMovementSubmit";
import type { Product } from "@/types/product";

const product: Product = {
  id: "p1",
  company_id: "c1",
  name: "Test",
  sku: null,
  unit: "un",
  min_quantity: 0,
  current_quantity: 10,
  last_unit_value: null,
  created_at: "",
  updated_at: "",
};

describe("manualStockMovementSubmit", () => {
  it("requires classification for entry", () => {
    const r = validateManualStockMovementInput({
      product,
      conversions: [],
      movementKind: "entry",
      classification: null,
      unitCode: "un",
      quantityRaw: "5",
      unitPriceRaw: "",
      movementDate: "2026-05-24",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("classificação");
  });

  it("allows inventory without classification", () => {
    const r = validateManualStockMovementInput({
      product,
      conversions: [],
      movementKind: "inventory",
      classification: null,
      unitCode: "un",
      quantityRaw: "-2",
      unitPriceRaw: "",
      movementDate: "2026-05-24",
    });
    expect(r.ok).toBe(true);
  });
});

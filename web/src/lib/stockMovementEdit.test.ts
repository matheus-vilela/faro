import { describe, expect, it } from "vitest";
import {
  stockMovementEditMode,
  stockMovementIsEditable,
  stockMovementOriginLabel,
  stockMovementSignedQuantity,
} from "@/lib/stockMovementEdit";

describe("stockMovementEditMode", () => {
  it("detects manual by registration_mode", () => {
    expect(
      stockMovementEditMode({
        reference_type: "manual",
        metadata_json: { registration_mode: "single" },
      }),
    ).toBe("manual");
    expect(
      stockMovementIsEditable({
        reference_type: "manual",
        metadata_json: { registration_mode: "batch" },
      }),
    ).toBe(true);
  });

  it("detects expense and import breakdown", () => {
    expect(
      stockMovementEditMode({
        reference_type: "expense_item",
        metadata_json: null,
      }),
    ).toBe("expense");
    expect(
      stockMovementEditMode({
        reference_type: "import_breakdown",
        metadata_json: null,
      }),
    ).toBe("expense");
  });

  it("blocks merge and revenue", () => {
    expect(
      stockMovementEditMode({
        reference_type: "product_merge",
        metadata_json: null,
      }),
    ).toBe("merge");
    expect(
      stockMovementIsEditable({
        reference_type: "revenue_entry",
        metadata_json: null,
      }),
    ).toBe(false);
  });
});

describe("stockMovementOriginLabel", () => {
  it("trata cadastro via NF-e como nota fiscal", () => {
    expect(
      stockMovementOriginLabel({
        reference_type: "nfe_staging_create",
        metadata_json: null,
      }),
    ).toBe("Nota fiscal");
  });
});

describe("stockMovementSignedQuantity", () => {
  it("signs by type", () => {
    expect(stockMovementSignedQuantity("in", 3)).toBe(3);
    expect(stockMovementSignedQuantity("out", 3)).toBe(-3);
    expect(stockMovementSignedQuantity("waste", 2)).toBe(-2);
  });
});

import { describe, expect, it } from "vitest";
import {
  expenseIsReceived,
  expenseItemHasVinculo,
  expenseItemVinculoKind,
  expenseItemVinculoLabel,
  parsePendingNewProduct,
} from "./expenseItemVinculo";

describe("expenseItemVinculoKind", () => {
  it("marks linked when product_id is set", () => {
    expect(
      expenseItemVinculoKind({
        product_id: "p1",
        import_resolution_status: "NEW_PRODUCT_STAGED",
      }),
    ).toBe("linked");
    expect(expenseItemVinculoLabel("linked")).toBe("Vinculado");
  });

  it("marks new product from status or staged metadata", () => {
    expect(
      expenseItemVinculoKind({
        product_id: null,
        import_resolution_status: "NEW_PRODUCT_STAGED",
      }),
    ).toBe("new_product");
    expect(
      expenseItemVinculoKind({
        product_id: null,
        metadata_json: {
          pending_new_product: { name: "Farinha", unit: "kg", conversions: [] },
        },
      }),
    ).toBe("new_product");
    expect(expenseItemVinculoLabel("new_product")).toBe("Novo no Faro");
  });

  it("marks none when unlinked and not staged", () => {
    expect(expenseItemVinculoKind({ product_id: null })).toBe("none");
    expect(expenseItemHasVinculo({ product_id: null })).toBe(false);
    expect(expenseItemHasVinculo({ product_id: "p1" })).toBe(true);
  });
});

describe("parsePendingNewProduct", () => {
  it("reads name, unit and conversions", () => {
    const parsed = parsePendingNewProduct({
      pending_new_product: {
        name: " Óleo ",
        unit: "L",
        conversions: [
          {
            primary_qty: 1,
            primary_unit_code: "l",
            secondary_qty: 20,
            secondary_unit_code: "cx",
          },
        ],
      },
    });
    expect(parsed).toEqual({
      name: "Óleo",
      unit: "l",
      conversions: [
        {
          primary_qty: 1,
          primary_unit_code: "l",
          secondary_qty: 20,
          secondary_unit_code: "cx",
        },
      ],
      canonical_name: null,
      ncm: null,
    });
  });

  it("returns null without a name", () => {
    expect(
      parsePendingNewProduct({ pending_new_product: { unit: "un" } }),
    ).toBeNull();
  });
});

describe("expenseIsReceived", () => {
  it("is true only when a recebimento is received", () => {
    expect(expenseIsReceived({})).toBe(false);
    expect(
      expenseIsReceived({ recebimentos: [{ status: "pending" }] }),
    ).toBe(false);
    expect(
      expenseIsReceived({ recebimentos: { status: "received" } }),
    ).toBe(true);
  });
});

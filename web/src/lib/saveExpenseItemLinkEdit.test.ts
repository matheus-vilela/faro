import { describe, expect, it } from "vitest";
import {
  draftToPendingNewProduct,
  isExpenseItemDraftDirty,
  mergeExpenseItemMetadata,
  stockQuantityForDraft,
  type ExpenseItemLinkEditDraft,
} from "./saveExpenseItemLinkEdit";

const baseDraft = (): ExpenseItemLinkEditDraft => ({
  mode: "create",
  productId: null,
  newProductName: " Farinha de trigo ",
  newProductUnit: "KG",
  invoiceUnit: "cx",
  quantity: 2,
  unitValue: 10,
  conversions: [
    {
      company_id: "c1",
      primary_qty: 1,
      primary_unit_code: "kg",
      secondary_qty: 10,
      secondary_unit_code: "cx",
    },
  ],
});

describe("mergeExpenseItemMetadata", () => {
  it("keeps product_merge and sets or clears pending_new_product", () => {
    const existing = {
      product_merge: {
        event_id: "e1",
        from_product_id: "a",
        from_product_name: "A",
        to_product_id: "b",
        merged_at: "t",
      },
    };
    const pending = draftToPendingNewProduct(baseDraft());
    const withPending = mergeExpenseItemMetadata(existing, pending);
    expect(withPending.product_merge).toEqual(existing.product_merge);
    expect(
      (withPending.pending_new_product as { name: string }).name,
    ).toBe("Farinha de trigo");
    expect(mergeExpenseItemMetadata(withPending, null).pending_new_product).toBeUndefined();
  });
});

describe("isExpenseItemDraftDirty", () => {
  it("ignores conversion object identity and detects field changes", () => {
    const a = baseDraft();
    const b: ExpenseItemLinkEditDraft = {
      ...a,
      conversions: a.conversions.map((c) => ({ ...c })),
    };
    expect(isExpenseItemDraftDirty(a, b)).toBe(false);
    expect(isExpenseItemDraftDirty({ ...a, quantity: 3 }, a)).toBe(true);
  });
});

describe("stockQuantityForDraft", () => {
  it("converts invoice unit to hub using the draft conversion", () => {
    expect(
      stockQuantityForDraft(2, "cx", "kg", baseDraft().conversions),
    ).toBe(0.2);
    expect(stockQuantityForDraft(3, "kg", "kg", [])).toBe(3);
  });
});

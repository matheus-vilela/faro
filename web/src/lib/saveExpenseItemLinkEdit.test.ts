import { describe, expect, it } from "vitest";
import {
  draftToPendingNewProduct,
  initialDraftFromItem,
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
  companyCategoryId: null,
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
    expect(
      isExpenseItemDraftDirty({ ...a, companyCategoryId: "cat-1" }, a),
    ).toBe(true);
  });
});

describe("initialDraftFromItem", () => {
  it("preenche categoria com o default do produto quando a linha está vazia", () => {
    const draft = initialDraftFromItem(
      {
        product_name: "Carne",
        quantity: 1,
        unit_value: 10,
        product_id: "p1",
        company_category_id: null,
      },
      "c1",
      { productDefaultCategoryId: "cat-default" },
    );
    expect(draft.companyCategoryId).toBe("cat-default");
  });

  it("usa a CMV do cadastro quando não há categoria de compra", () => {
    const draft = initialDraftFromItem(
      {
        product_name: "Peito de frango",
        quantity: 1,
        unit_value: 10,
        product_id: "p1",
        company_category_id: null,
      },
      "c1",
      { productCmvCategoryId: "cmv-alimentos" },
    );
    expect(draft.companyCategoryId).toBe("cmv-alimentos");
  });

  it("mantém a categoria da linha mesmo com default no produto", () => {
    const draft = initialDraftFromItem(
      {
        product_name: "Carne",
        quantity: 1,
        unit_value: 10,
        product_id: "p1",
        company_category_id: "cat-line",
      },
      "c1",
      { productDefaultCategoryId: "cat-default" },
    );
    expect(draft.companyCategoryId).toBe("cat-line");
  });

  it("grava categoria na linha sem produto, sem default de cadastro", () => {
    const draft = initialDraftFromItem(
      {
        product_name: "Avulso",
        quantity: 1,
        unit_value: 5,
        company_category_id: "cat-line",
      },
      "c1",
    );
    expect(draft.mode).toBe("none");
    expect(draft.companyCategoryId).toBe("cat-line");
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

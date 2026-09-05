import { describe, expect, it } from "vitest";
import {
  contextFromExpenseItem,
  formatInvoiceLabel,
  isNfeProductCreateReference,
  pickClosestExpenseItem,
} from "@/lib/stockMovementInvoiceContext";

describe("formatInvoiceLabel", () => {
  it("monta NF e série", () => {
    expect(formatInvoiceLabel("123", "1")).toBe("NF 123 · série 1");
    expect(formatInvoiceLabel("123", null)).toBe("NF 123");
    expect(formatInvoiceLabel("  ", "1")).toBeNull();
  });
});

describe("isNfeProductCreateReference", () => {
  it("reconhece cadastro via NF-e", () => {
    expect(isNfeProductCreateReference("nfe_staging_create")).toBe(true);
    expect(isNfeProductCreateReference("expense_item")).toBe(false);
  });
});

describe("pickClosestExpenseItem", () => {
  it("prefere o item com custo mais próximo", () => {
    const picked = pickClosestExpenseItem(
      [
        { created_at: "2026-09-01T10:00:00Z", unit_value: 80 },
        { created_at: "2026-09-01T10:00:02Z", unit_value: 12 },
      ],
      "2026-09-01T10:00:01Z",
      12,
    );
    expect(picked?.unit_value).toBe(12);
  });
});

describe("contextFromExpenseItem", () => {
  it("lê nota, fornecedor, qtd e nome original", () => {
    const ctx = contextFromExpenseItem({
      id: "i1",
      expense_id: "e1",
      product_id: "p1",
      product_name: "COCA COLA LATA 350ML",
      quantity: 24,
      invoice_unit: "cx",
      unit_value: 48,
      created_at: "2026-09-01T10:00:00Z",
      expenses: {
        id: "e1",
        invoice_number: "4451",
        invoice_series: "1",
        supplier_name: "Distribuidora X",
        supplier_document: "123",
        supplier_id: "s1",
        created_at: "2026-09-01T10:00:00Z",
        suppliers: { id: "s1", name: "Distribuidora X", document: "123" },
      },
    });
    expect(ctx.invoiceNumber).toBe("4451");
    expect(ctx.supplierName).toBe("Distribuidora X");
    expect(ctx.originalItemName).toBe("COCA COLA LATA 350ML");
    expect(ctx.invoiceQuantity).toBe(24);
    expect(ctx.invoiceUnit).toBe("cx");
    expect(ctx.expenseId).toBe("e1");
  });
});

import { describe, expect, it } from "vitest";
import {
  mergeProductSupplierEntries,
  productSupplierKey,
  type ProductSupplierEntry,
} from "@/lib/productSuppliers";

function entry(
  partial: Partial<ProductSupplierEntry> & Pick<ProductSupplierEntry, "name">,
): ProductSupplierEntry {
  return {
    key: partial.key ?? productSupplierKey(partial.supplierId ?? null, partial.name),
    supplierId: partial.supplierId ?? null,
    name: partial.name,
    document: partial.document ?? null,
    purchaseCount: partial.purchaseCount ?? 0,
    lastPurchaseAt: partial.lastPurchaseAt ?? "",
    lastUnitValue: partial.lastUnitValue ?? null,
    viaNfe: partial.viaNfe ?? false,
  };
}

describe("mergeProductSupplierEntries", () => {
  it("mostra o emitente da NF-e sem despesa", () => {
    const merged = mergeProductSupplierEntries(
      [],
      [
        entry({
          supplierId: "s1",
          name: "Distribuidora X",
          document: "123",
          lastPurchaseAt: "2026-09-01",
          viaNfe: true,
        }),
      ],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.viaNfe).toBe(true);
    expect(merged[0]?.name).toBe("Distribuidora X");
  });

  it("não duplica o mesmo fornecedor da despesa e da NF-e", () => {
    const merged = mergeProductSupplierEntries(
      [
        entry({
          supplierId: "s1",
          name: "Distribuidora X",
          purchaseCount: 2,
          lastPurchaseAt: "2026-09-02",
          lastUnitValue: 10,
        }),
      ],
      [
        entry({
          supplierId: "s1",
          name: "Distribuidora X",
          lastPurchaseAt: "2026-08-01",
          viaNfe: true,
        }),
      ],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.purchaseCount).toBe(2);
    expect(merged[0]?.viaNfe).toBe(true);
    expect(merged[0]?.lastUnitValue).toBe(10);
  });
});

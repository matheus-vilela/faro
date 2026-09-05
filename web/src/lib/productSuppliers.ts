export type ProductSupplierEntry = {
  key: string;
  supplierId: string | null;
  name: string;
  document: string | null;
  purchaseCount: number;
  lastPurchaseAt: string;
  lastUnitValue: number | null;
  /** Vínculo da NF-e (cadastro/entrada), mesmo sem linha de despesa. */
  viaNfe: boolean;
};

export const NFE_PRODUCT_CREATE_REFERENCE_TYPES = [
  "nfe_staging_create",
  "nfe_product_create",
  "nfe_motor_create",
] as const;

export function productSupplierKey(
  supplierId: string | null,
  name: string,
): string {
  if (supplierId) return supplierId;
  return `nf:${name.trim().toLowerCase() || "sem-nome"}`;
}

export function mergeProductSupplierEntries(
  fromExpenses: ProductSupplierEntry[],
  fromNfeLastro: ProductSupplierEntry[],
): ProductSupplierEntry[] {
  const map = new Map<string, ProductSupplierEntry>();
  for (const row of fromExpenses) {
    map.set(row.key, { ...row });
  }
  for (const row of fromNfeLastro) {
    const existing = map.get(row.key);
    if (!existing) {
      map.set(row.key, { ...row, viaNfe: true });
      continue;
    }
    existing.viaNfe = true;
    if (
      !existing.lastPurchaseAt ||
      (row.lastPurchaseAt &&
        row.lastPurchaseAt > existing.lastPurchaseAt &&
        existing.purchaseCount === 0)
    ) {
      existing.lastPurchaseAt = row.lastPurchaseAt || existing.lastPurchaseAt;
    }
    if (existing.lastUnitValue == null && row.lastUnitValue != null) {
      existing.lastUnitValue = row.lastUnitValue;
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      b.purchaseCount - a.purchaseCount ||
      a.name.localeCompare(b.name, "pt-BR"),
  );
}

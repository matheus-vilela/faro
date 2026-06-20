import type { Product } from "@/types/product";

export type BatchPickerProduct = Product & {
  categoryIds: string[];
};

export function filterProductsForBatchPicker(
  products: BatchPickerProduct[],
  opts: {
    search: string;
    categoryIds: string[];
    supplierIds: string[];
    productSupplierIds: Map<string, string[]>;
  },
): BatchPickerProduct[] {
  const search = opts.search.trim().toLowerCase();
  const hasCategoryFilter = opts.categoryIds.length > 0;
  const hasSupplierFilter = opts.supplierIds.length > 0;

  return products.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search)) {
      return false;
    }
    if (hasCategoryFilter) {
      const cats = p.categoryIds;
      if (!opts.categoryIds.some((id) => cats.includes(id))) {
        return false;
      }
    }
    if (hasSupplierFilter) {
      const linked = opts.productSupplierIds.get(p.id) ?? [];
      if (!opts.supplierIds.some((sid) => linked.includes(sid))) {
        return false;
      }
    }
    return true;
  });
}

export function defaultBatchLineDraft(product: Product) {
  return {
    unitCode: product.unit,
    quantity: "1",
    unitPrice: "",
    expiryDate: "",
  };
}

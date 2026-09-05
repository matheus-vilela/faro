import type { ProductSetupItem } from "@/lib/productSetupQueue";

export type ProductSetupOriginFilter = "all" | "pdv" | "nota" | "ficha";

export const PRODUCT_SETUP_ORIGIN_LABEL: Record<
  ProductSetupOriginFilter,
  string
> = {
  all: "Todos",
  pdv: "PDV",
  nota: "Nota fiscal",
  ficha: "Ficha",
};

export function setupItemOrigin(
  item: Pick<ProductSetupItem, "kind">,
): Exclude<ProductSetupOriginFilter, "all"> {
  if (item.kind === "purchase_unlinked") return "nota";
  if (
    item.kind === "recipe_without_ingredients" ||
    item.kind === "recipe_sales_unlinked"
  ) {
    return "ficha";
  }
  return "pdv";
}

function haystack(item: ProductSetupItem): string {
  return [item.name, item.sku, item.ean, item.barcode, item.sourceLabel]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function setupItemMatchesFilters(
  item: ProductSetupItem,
  query: string,
  origin: ProductSetupOriginFilter,
): boolean {
  if (origin !== "all" && setupItemOrigin(item) !== origin) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystack(item).includes(q);
}

import type {
  ProductSetupChoice,
  ProductSetupItem,
} from "@/lib/productSetupQueue";

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

export function setupItemSourceLabel(
  item: Pick<ProductSetupItem, "kind">,
): string {
  return item.kind === "purchase_unlinked"
    ? "Nota fiscal / compra"
    : "PDV / venda";
}

export const SETUP_STOCK_ONLY_LABEL = "Somente estoque";

export function setupItemShowsStockOnly(
  item: Pick<ProductSetupItem, "possibleGrouping">,
  choice?: ProductSetupChoice | null,
): boolean {
  if (item.possibleGrouping !== true) return false;
  if (choice == null) return true;
  return choice === "sale_family_variant";
}

function haystack(item: ProductSetupItem): string {
  return [
    item.name,
    item.sku,
    item.ean,
    item.barcode,
    item.sourceLabel,
    setupItemShowsStockOnly(item) ? SETUP_STOCK_ONLY_LABEL : "",
  ]
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

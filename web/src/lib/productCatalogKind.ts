export const PRODUCT_CATALOG_KINDS = [
  "all",
  "recipe",
  "grouping",
  "possible_grouping",
  "production",
  "product",
] as const;

export type ProductCatalogKind = (typeof PRODUCT_CATALOG_KINDS)[number];

export const PRODUCT_CATALOG_KIND_LABELS: Record<ProductCatalogKind, string> = {
  all: "Todos",
  recipe: "Ficha técnica",
  grouping: "Agrupamento",
  possible_grouping: "Possível agrupamento",
  production: "Produção",
  product: "Produto",
};

export type ProductCatalogKindClause =
  | {
      mode: "listed_or_sale_family";
    }
  | {
      mode: "listed_product_types";
      types: readonly string[];
      includeNullType: true;
    }
  | {
      mode: "stock_control_type";
      type: string;
    }
  | {
      mode: "possible_grouping";
    };

export function productCatalogKindClause(
  kind: ProductCatalogKind,
): ProductCatalogKindClause {
  switch (kind) {
    case "product":
      return {
        mode: "listed_product_types",
        types: ["DIRECT", "COMPOSITE", "SERVICE"],
        includeNullType: true,
      };
    case "production":
      return { mode: "stock_control_type", type: "INTERMEDIATE" };
    case "grouping":
      return { mode: "stock_control_type", type: "SALE_FAMILY" };
    case "possible_grouping":
      return { mode: "possible_grouping" };
    case "recipe":
      return { mode: "stock_control_type", type: "RECIPE_CONTROLLED" };
    case "all":
    default:
      return { mode: "listed_or_sale_family" };
  }
}

type FilterableQuery = {
  or: (filters: string) => FilterableQuery;
  eq: (column: string, value: string | boolean) => FilterableQuery;
};

export function applyProductCatalogKindFilter<T>(
  q: T,
  kind: ProductCatalogKind,
): T {
  const query = q as FilterableQuery;
  const clause = productCatalogKindClause(kind);
  if (clause.mode === "listed_or_sale_family") {
    return query.or(
      "listed_in_product_catalog.eq.true,stock_control_type.eq.SALE_FAMILY",
    ) as T;
  }
  if (clause.mode === "listed_product_types") {
    const typeOr = [
      "stock_control_type.is.null",
      ...clause.types.map((type) => `stock_control_type.eq.${type}`),
    ].join(",");
    return query.eq("listed_in_product_catalog", true).or(typeOr) as T;
  }
  if (clause.mode === "possible_grouping") {
    return query
      .eq("listed_in_product_catalog", true)
      .eq("stock_only_origin", true)
      .or("not_sale_grouping.is.null,not_sale_grouping.eq.false")
      .or(
        "stock_control_type.is.null,stock_control_type.eq.DIRECT,stock_control_type.eq.COMPOSITE,stock_control_type.eq.SERVICE",
      ) as T;
  }
  return query.eq("stock_control_type", clause.type) as T;
}

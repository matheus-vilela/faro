import { describe, expect, it } from "vitest";
import {
  PRODUCT_CATALOG_KIND_LABELS,
  applyProductCatalogKindFilter,
  productCatalogKindClause,
} from "@/lib/productCatalogKind";

describe("productCatalogKindClause", () => {
  it("mantém o catálogo padrão em Todos", () => {
    expect(productCatalogKindClause("all")).toEqual({
      mode: "listed_or_sale_family",
    });
  });

  it("trata produto como SKU listado, sem ficha/agrupamento/produção", () => {
    expect(productCatalogKindClause("product")).toEqual({
      mode: "listed_product_types",
      types: ["DIRECT", "COMPOSITE", "SERVICE"],
      includeNullType: true,
    });
  });

  it("isola ficha, agrupamento e produção pelo stock_control_type", () => {
    expect(productCatalogKindClause("recipe")).toEqual({
      mode: "stock_control_type",
      type: "RECIPE_CONTROLLED",
    });
    expect(productCatalogKindClause("grouping")).toEqual({
      mode: "stock_control_type",
      type: "SALE_FAMILY",
    });
    expect(productCatalogKindClause("production")).toEqual({
      mode: "stock_control_type",
      type: "INTERMEDIATE",
    });
    expect(productCatalogKindClause("possible_grouping")).toEqual({
      mode: "possible_grouping",
    });
  });

  it("tem rótulo para cada tipo", () => {
    expect(PRODUCT_CATALOG_KIND_LABELS.recipe).toBe("Ficha técnica");
    expect(PRODUCT_CATALOG_KIND_LABELS.grouping).toBe("Agrupamento");
    expect(PRODUCT_CATALOG_KIND_LABELS.possible_grouping).toBe(
      "Possível agrupamento",
    );
    expect(PRODUCT_CATALOG_KIND_LABELS.production).toBe("Produção");
    expect(PRODUCT_CATALOG_KIND_LABELS.product).toBe("Produto");
  });
});

describe("applyProductCatalogKindFilter", () => {
  function makeQuery() {
    const calls: Array<{ fn: string; args: unknown[] }> = [];
    const q = {
      calls,
      or(filters: string) {
        calls.push({ fn: "or", args: [filters] });
        return q;
      },
      eq(column: string, value: string | boolean) {
        calls.push({ fn: "eq", args: [column, value] });
        return q;
      },
    };
    return q;
  }

  it("não exige listagem ao filtrar ficha técnica", () => {
    const q = makeQuery();
    applyProductCatalogKindFilter(q, "recipe");
    expect(q.calls).toEqual([
      { fn: "eq", args: ["stock_control_type", "RECIPE_CONTROLLED"] },
    ]);
  });

  it("filtra possível agrupamento como a tag", () => {
    const q = makeQuery();
    applyProductCatalogKindFilter(q, "possible_grouping");
    expect(q.calls).toEqual([
      { fn: "eq", args: ["listed_in_product_catalog", true] },
      { fn: "eq", args: ["stock_only_origin", true] },
      {
        fn: "or",
        args: ["not_sale_grouping.is.null,not_sale_grouping.eq.false"],
      },
      {
        fn: "or",
        args: [
          "stock_control_type.is.null,stock_control_type.eq.DIRECT,stock_control_type.eq.COMPOSITE,stock_control_type.eq.SERVICE",
        ],
      },
    ]);
  });

  it("aplica listados ou agrupamento em Todos", () => {
    const q = makeQuery();
    applyProductCatalogKindFilter(q, "all");
    expect(q.calls).toEqual([
      {
        fn: "or",
        args: [
          "listed_in_product_catalog.eq.true,stock_control_type.eq.SALE_FAMILY",
        ],
      },
    ]);
  });
});

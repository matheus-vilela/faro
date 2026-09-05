import { describe, expect, it } from "vitest";
import type { ProductSetupItem } from "@/lib/productSetupQueue";
import {
  setupItemMatchesFilters,
  setupItemOrigin,
  setupItemSourceLabel,
} from "@/lib/productSetupListFilter";

function item(
  kind: ProductSetupItem["kind"],
  name: string,
  extra: Partial<ProductSetupItem> = {},
): ProductSetupItem {
  return {
    key: `${kind}:${name}`,
    productId: name,
    name,
    unit: "un",
    quantity: 0,
    kind,
    sourceLabel: kind === "purchase_unlinked" ? "Nota / compra" : "PDV / venda",
    pendingQuestion: "",
    ...extra,
  };
}

describe("setupItemOrigin", () => {
  it("classifica nota, pdv e ficha", () => {
    expect(setupItemOrigin(item("purchase_unlinked", "Açúcar"))).toBe("nota");
    expect(setupItemOrigin(item("sold_unlinked", "Heineken"))).toBe("pdv");
    expect(setupItemOrigin(item("recipe_without_ingredients", "Caipirinha"))).toBe(
      "ficha",
    );
    expect(setupItemOrigin(item("recipe_sales_unlinked", "Caipirinha"))).toBe(
      "ficha",
    );
  });

  it("rótulo informa PDV venda ou nota compra", () => {
    expect(setupItemSourceLabel(item("purchase_unlinked", "Açúcar"))).toBe(
      "Nota fiscal / compra",
    );
    expect(setupItemSourceLabel(item("sold_unlinked", "Heineken"))).toBe(
      "PDV / venda",
    );
    expect(
      setupItemSourceLabel(item("recipe_without_ingredients", "Caipirinha")),
    ).toBe("PDV / venda");
  });
});

describe("setupItemMatchesFilters", () => {
  const rows = [
    item("purchase_unlinked", "Açúcar cristal", { sku: "AC1", ean: "789" }),
    item("sold_unlinked", "Heineken 600"),
    item("recipe_without_ingredients", "Caipirinha"),
  ];

  it("filtra por origem", () => {
    expect(
      rows.filter((row) => setupItemMatchesFilters(row, "", "nota")).map((r) => r.name),
    ).toEqual(["Açúcar cristal"]);
    expect(
      rows.filter((row) => setupItemMatchesFilters(row, "", "pdv")).map((r) => r.name),
    ).toEqual(["Heineken 600"]);
    expect(
      rows.filter((row) => setupItemMatchesFilters(row, "", "ficha")).map((r) => r.name),
    ).toEqual(["Caipirinha"]);
  });

  it("busca nome, sku e ean", () => {
    expect(
      rows.filter((row) => setupItemMatchesFilters(row, "789", "all")).map((r) => r.name),
    ).toEqual(["Açúcar cristal"]);
    expect(
      rows.filter((row) => setupItemMatchesFilters(row, "hein", "all")).map((r) => r.name),
    ).toEqual(["Heineken 600"]);
  });
});

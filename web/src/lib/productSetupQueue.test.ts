import { describe, expect, it } from "vitest";
import {
  excludeSaleFamilyResolvedItems,
  setupChoicesForItem,
  suggestedSetupChoice,
  type ProductSetupItem,
} from "@/lib/productSetupQueue";

function item(kind: ProductSetupItem["kind"]): ProductSetupItem {
  return {
    key: kind,
    productId: "p1",
    name: "Item",
    unit: "un",
    quantity: 0,
    kind,
    sourceLabel: "PDV",
    pendingQuestion: "",
  };
}

describe("setupChoicesForItem", () => {
  it("no vendido inclui agrupamento, intermediário e produto", () => {
    const values = setupChoicesForItem(item("sold_unlinked")).map((o) => o.value);
    expect(values).toEqual([
      "link_item",
      "recipe",
      "intermediate",
      "sale_family",
      "sale_family_variant",
      "skip",
    ]);
  });

  it("na compra inclui insumo, variante e intermediário", () => {
    const values = setupChoicesForItem(item("purchase_unlinked")).map(
      (o) => o.value,
    );
    expect(values).toEqual([
      "link_item",
      "ingredient",
      "sale_family_variant",
      "intermediate",
      "skip",
    ]);
  });

  it("em vendas da ficha só abre a ficha", () => {
    expect(
      setupChoicesForItem(item("recipe_sales_unlinked")).map((o) => o.value),
    ).toEqual(["recipe"]);
  });
});

describe("suggestedSetupChoice", () => {
  it("pré-seleciona variante quando o produto é possível agrupamento", () => {
    expect(
      suggestedSetupChoice({
        ...item("sold_unlinked"),
        possibleGrouping: true,
      }),
    ).toBe("sale_family_variant");
  });

  it("na compra também sugere fazer parte de um agrupamento", () => {
    expect(
      suggestedSetupChoice({
        ...item("purchase_unlinked"),
        possibleGrouping: true,
      }),
    ).toBe("sale_family_variant");
  });

  it("não sugere papel sem o sinal de agrupamento", () => {
    expect(suggestedSetupChoice(item("sold_unlinked"))).toBeUndefined();
  });
});

describe("excludeSaleFamilyResolvedItems", () => {
  it("tira da fila variante ou agrupamento já ligado", () => {
    const sold = item("sold_unlinked");
    const other = { ...item("purchase_unlinked"), productId: "p2", key: "p2" };
    expect(
      excludeSaleFamilyResolvedItems([sold, other], new Set(["p1"])).map(
        (row) => row.productId,
      ),
    ).toEqual(["p2"]);
  });

  it("mantém a lista quando ninguém está resolvido", () => {
    expect(excludeSaleFamilyResolvedItems([item("sold_unlinked")], new Set()))
      .toHaveLength(1);
  });
});

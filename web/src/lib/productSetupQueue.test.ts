import { describe, expect, it } from "vitest";
import {
  setupChoicesForItem,
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

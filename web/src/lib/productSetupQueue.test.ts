import { describe, expect, it } from "vitest";
import {
  compareTurnoverDesc,
  excludeSaleFamilyResolvedItems,
  itemTurnoverAmount,
  partitionSalesThenPurchases,
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
      "ingredient",
      "skip",
    ]);
  });

  it("em ficha incompleta não oferece insumo", () => {
    expect(
      setupChoicesForItem(item("recipe_without_ingredients")).map((o) => o.value),
    ).toEqual([
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

describe("itemTurnoverAmount", () => {
  it("usa volume × valor de referência", () => {
    expect(
      itemTurnoverAmount({
        ...item("purchase_unlinked"),
        turnoverQty: 2,
        referenceUnitValue: 50,
      }),
    ).toBe(100);
  });

  it("prefere o total agregado quando existir", () => {
    expect(
      itemTurnoverAmount({
        ...item("sold_unlinked"),
        turnoverQty: 10,
        referenceUnitValue: 5,
        turnoverAmount: 80,
      }),
    ).toBe(80);
  });
});

describe("compareTurnoverDesc", () => {
  it("sobe item de baixo volume e alto valor", () => {
    const cheap = {
      ...item("purchase_unlinked"),
      name: "Água",
      turnoverQty: 40,
      referenceUnitValue: 2,
    };
    const pricey = {
      ...item("sold_unlinked"),
      name: "Whisky",
      turnoverQty: 2,
      referenceUnitValue: 180,
    };
    expect(compareTurnoverDesc(cheap, pricey)).toBeGreaterThan(0);
    expect([cheap, pricey].sort(compareTurnoverDesc).map((r) => r.name)).toEqual(
      ["Whisky", "Água"],
    );
  });

  it("sem preço desempata pelo volume", () => {
    const low = { ...item("sold_unlinked"), name: "A", turnoverQty: 2 };
    const high = { ...item("sold_unlinked"), name: "B", turnoverQty: 40 };
    expect([low, high].sort(compareTurnoverDesc).map((r) => r.name)).toEqual([
      "B",
      "A",
    ]);
  });

  it("lista vendas antes das compras da nota", () => {
    const purchase = {
      ...item("purchase_unlinked"),
      name: "Açúcar",
      turnoverQty: 80,
      referenceUnitValue: 20,
    };
    const sold = {
      ...item("sold_unlinked"),
      name: "Dose",
      turnoverQty: 1,
      referenceUnitValue: 8,
    };
    expect(
      [purchase, sold].sort(compareTurnoverDesc).map((r) => r.name),
    ).toEqual(["Dose", "Açúcar"]);
    expect(
      partitionSalesThenPurchases(
        [purchase, sold],
        (row) => row.kind,
      ).map((r) => r.name),
    ).toEqual(["Dose", "Açúcar"]);
  });
});

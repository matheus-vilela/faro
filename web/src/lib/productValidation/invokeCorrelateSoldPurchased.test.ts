import { describe, expect, it } from "vitest";
import type { ProductSetupItem } from "@/lib/productSetupQueue";
import {
  itemsPendingAiCorrelation,
  mergeValidationResults,
} from "@/lib/productValidation/invokeCorrelateSoldPurchased";
import type { ProductValidationResult } from "@/lib/productValidation/types";

function sold(id: string, name: string): ProductSetupItem {
  return {
    key: `sold:${id}`,
    productId: id,
    name,
    unit: "un",
    quantity: 1,
    kind: "sold_unlinked",
    sourceLabel: "PDV",
    pendingQuestion: "",
  };
}

function purchase(id: string, name: string): ProductSetupItem {
  return {
    key: `purchase:${id}`,
    productId: id,
    name,
    unit: "un",
    quantity: 1,
    kind: "purchase_unlinked",
    sourceLabel: "Nota",
    pendingQuestion: "",
  };
}

function highSame(
  soldItem: ProductSetupItem,
  purchaseItem: ProductSetupItem,
): ProductValidationResult {
  return {
    sameItem: [
      {
        id: `same:${soldItem.productId}`,
        sold: soldItem,
        candidates: [{ purchase: purchaseItem, score: 96, reasons: [] }],
        band: "high",
        conflictWithRecipe: false,
      },
    ],
    recipes: [],
    residual: [],
    unmatchedSold: [],
    stats: { sold: 1, purchases: 1, sameItem: 1, recipes: 0, residual: 0 },
  };
}

describe("itemsPendingAiCorrelation", () => {
  it("manda a fila inteira na primeira leitura", () => {
    const gin = sold("s1", "Gin");
    const nf = purchase("p1", "Gin NF");
    expect(
      itemsPendingAiCorrelation([gin, nf], new Set()).map((row) => row.productId),
    ).toEqual(["s1", "p1"]);
  });

  it("não remete o que a IA já leu nem o que o usuário classificou", () => {
    const gin = sold("s1", "Gin");
    const agua = sold("s2", "Água");
    const nf = purchase("p1", "Gin NF");
    expect(
      itemsPendingAiCorrelation(
        [gin, agua, nf],
        new Set(["s1", "p1"]),
        new Set(["s2"]),
      ).map((row) => row.productId),
    ).toEqual([]);
  });
});

describe("mergeValidationResults", () => {
  it("mantém o par antigo e acrescenta o novo", () => {
    const gin = sold("s1", "Gin");
    const ginNf = purchase("p1", "Gin NF");
    const agua = sold("s2", "Água");
    const aguaNf = purchase("p2", "Água NF");
    const merged = mergeValidationResults(
      highSame(gin, ginNf),
      highSame(agua, aguaNf),
    );
    expect(merged.sameItem.map((row) => row.sold.productId)).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("se a nova leitura reusa a compra, o par antigo solta esse candidato", () => {
    const gin = sold("s1", "Gin");
    const agua = sold("s2", "Água");
    const nf = purchase("p1", "Garrafa");
    const merged = mergeValidationResults(highSame(gin, nf), highSame(agua, nf));
    expect(merged.sameItem).toHaveLength(1);
    expect(merged.sameItem[0]?.sold.productId).toBe("s2");
  });
});

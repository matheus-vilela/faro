import { describe, expect, it } from "vitest";
import type { ProductSetupItem } from "@/lib/productSetupQueue";
import {
  buildCorrelationCases,
  excludeResolvedCases,
  listCorrelationCases,
  recommendIntents,
  suggestIntent,
  intentsForItem,
} from "@/lib/productValidation/correlationCase";
import type { ProductValidationResult } from "@/lib/productValidation/types";

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
    sourceLabel: kind === "purchase_unlinked" ? "Nota" : "PDV",
    pendingQuestion: "",
    ...extra,
  };
}

describe("suggestIntent", () => {
  it("possível agrupamento vira variante", () => {
    const sold = item("sold_unlinked", "Bolinho", { possibleGrouping: true });
    expect(suggestIntent(sold, intentsForItem(sold))).toBe("variant");
  });

  it("compra sem sinal sugere insumo", () => {
    const purchase = item("purchase_unlinked", "Açúcar");
    expect(suggestIntent(purchase, intentsForItem(purchase))).toBe("ingredient");
  });

  it("no vendido também oferece é um insumo", () => {
    expect(intentsForItem(item("sold_unlinked", "Limão"))).toContain(
      "ingredient",
    );
  });

  it("dica da IA de ficha vence unificar", () => {
    const sold = item("sold_unlinked", "DS GIN");
    expect(suggestIntent(sold, intentsForItem(sold), "recipe")).toBe("recipe");
  });
});

describe("recommendIntents", () => {
  it("coloca o sugerido na frente e corta em 3", () => {
    expect(
      recommendIntents("variant", [
        "unify",
        "recipe",
        "produce",
        "family",
        "variant",
        "keep",
      ]),
    ).toEqual(["variant", "family", "keep"]);
  });
});

describe("buildCorrelationCases", () => {
  it("ordena por score e não esconde item sem par", () => {
    const sold = item("sold_unlinked", "Gin", { turnoverQty: 2 });
    const leftover = item("sold_unlinked", "Água", { turnoverQty: 40 });
    const purchase = item("purchase_unlinked", "Gin NF");
    const result: ProductValidationResult = {
      sameItem: [
        {
          id: "same:Gin",
          sold,
          candidates: [{ purchase, score: 94, reasons: [] }],
          band: "high",
          conflictWithRecipe: false,
        },
      ],
      recipes: [],
      residual: [leftover],
      stats: { sold: 2, purchases: 1, sameItem: 1, recipes: 0, residual: 1 },
    };
    const cases = buildCorrelationCases([sold, leftover], result);
    expect(cases.map((row) => row.subject.name)).toEqual(["Gin", "Água"]);
    expect(cases[0]?.score).toBe(94);
    expect(cases[0]?.suggestedIntent).toBe("unify");
    expect(cases[0]?.aiIntent).toBe("unify");
    expect(cases[0]?.isUnifyMatch).toBe(true);
    expect(cases[1]?.score).toBe(0);
    expect(cases[1]?.aiIntent).toBeNull();
    expect(cases[1]?.isUnifyMatch).toBe(false);
  });

  it("coloca o match de unificar na frente mesmo com giro menor", () => {
    const sold = item("sold_unlinked", "Gin", { turnoverAmount: 10 });
    const leftover = item("sold_unlinked", "Água", { turnoverAmount: 400 });
    const purchase = item("purchase_unlinked", "Gin NF");
    const result: ProductValidationResult = {
      sameItem: [
        {
          id: "same:Gin",
          sold,
          candidates: [{ purchase, score: 96, reasons: [] }],
          band: "high",
          conflictWithRecipe: false,
        },
      ],
      recipes: [],
      residual: [leftover],
      stats: { sold: 2, purchases: 1, sameItem: 1, recipes: 0, residual: 1 },
    };
    const cases = buildCorrelationCases([leftover, sold], result);
    expect(cases.map((row) => row.subject.name)).toEqual(["Gin", "Água"]);
  });

  it("não trata ficha ou match fraco como unificar no topo", () => {
    const dose = item("sold_unlinked", "DS GIN");
    const review = item("sold_unlinked", "Suco");
    const purchase = item("purchase_unlinked", "Gin NF");
    const sucoNf = item("purchase_unlinked", "Suco NF");
    const result: ProductValidationResult = {
      sameItem: [
        {
          id: "same:DS",
          sold: dose,
          candidates: [{ purchase, score: 95, reasons: [] }],
          band: "review",
          conflictWithRecipe: true,
        },
        {
          id: "same:Suco",
          sold: review,
          candidates: [{ purchase: sucoNf, score: 70, reasons: [] }],
          band: "review",
          conflictWithRecipe: false,
        },
      ],
      recipes: [],
      residual: [],
      stats: { sold: 2, purchases: 2, sameItem: 2, recipes: 0, residual: 0 },
    };
    const cases = buildCorrelationCases([dose, review], result);
    expect(cases.every((row) => row.isUnifyMatch)).toBe(false);
  });

  it("listCorrelationCases mantém o resto depois do bloco de unificar", () => {
    const gin = item("sold_unlinked", "Gin");
    const agua = item("sold_unlinked", "Água");
    const nota = item("purchase_unlinked", "Açúcar");
    const cases = buildCorrelationCases([nota, agua, gin], {
      sameItem: [
        {
          id: "same:Gin",
          sold: gin,
          candidates: [
            {
              purchase: item("purchase_unlinked", "Gin NF"),
              score: 99,
              reasons: [],
            },
          ],
          band: "high",
          conflictWithRecipe: false,
        },
      ],
      recipes: [],
      residual: [agua, nota],
      stats: { sold: 2, purchases: 1, sameItem: 1, recipes: 0, residual: 2 },
    });
    expect(listCorrelationCases(cases).map((row) => row.subject.name)).toEqual([
      "Gin",
      "Água",
      "Açúcar",
    ]);
  });

  it("na compra também aponta o vendido do mesmo item", () => {
    const sold = item("sold_unlinked", "Coca PDV");
    const purchase = item("purchase_unlinked", "Coca NF");
    const result: ProductValidationResult = {
      sameItem: [
        {
          id: "same:Coca",
          sold,
          candidates: [{ purchase, score: 100, reasons: [] }],
          band: "high",
          conflictWithRecipe: false,
        },
      ],
      recipes: [],
      residual: [],
      stats: { sold: 1, purchases: 1, sameItem: 1, recipes: 0, residual: 0 },
    };
    const cases = buildCorrelationCases([purchase], result);
    expect(cases[0]?.aiIntent).toBe("unify");
    expect(cases[0]?.counterparts.map((row) => row.item.name)).toEqual([
      "Coca PDV",
    ]);
  });

  it("esconde o produto já resolvido da listagem", () => {
    const sold = item("sold_unlinked", "Gin");
    const leftover = item("sold_unlinked", "Água");
    const cases = buildCorrelationCases([sold, leftover], null);
    expect(
      excludeResolvedCases(cases, new Set(["Gin"])).map((row) => row.subject.name),
    ).toEqual(["Água"]);
  });
});

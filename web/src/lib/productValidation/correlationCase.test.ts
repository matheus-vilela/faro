import { describe, expect, it } from "vitest";
import type { ProductSetupItem } from "@/lib/productSetupQueue";
import {
  buildCorrelationCases,
  excludeResolvedCases,
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
    expect(cases[1]?.score).toBe(0);
    expect(cases[1]?.aiIntent).toBeNull();
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

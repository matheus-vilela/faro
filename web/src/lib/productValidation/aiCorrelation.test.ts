import { describe, expect, it } from "vitest";
import type { ProductSetupItem } from "@/lib/productSetupQueue";
import {
  finalizeAiAssignments,
  mapAiAssignmentsToValidationResult,
  parseAiCorrelationRaw,
} from "@/lib/productValidation/aiCorrelation";

function item(
  id: string,
  name: string,
  kind: ProductSetupItem["kind"],
): ProductSetupItem {
  return {
    key: `${kind}:${id}`,
    productId: id,
    name,
    unit: "un",
    quantity: 0,
    kind,
    sourceLabel: kind === "purchase_unlinked" ? "Nota" : "PDV",
    pendingQuestion: "",
  };
}

describe("parse + finalize AI correlation", () => {
  it("cobre todo vendido e não reusa a mesma compra em dois same_item", () => {
    const soldIds = ["s1", "s2", "s3"];
    const purchasedIds = new Set(["p1", "p2"]);
    const parsed = parseAiCorrelationRaw(
      {
        assignments: [
          {
            sold: "s1",
            kind: "same_item",
            purchased: ["p1"],
            confidence: 0.95,
            reason_pt: "Heineken",
          },
          {
            sold: "s2",
            kind: "same_item",
            purchased: ["p1", "p2"],
            confidence: 0.7,
            reason_pt: "também heineken",
          },
        ],
      },
      new Set(soldIds),
      purchasedIds,
    );
    const final = finalizeAiAssignments(soldIds, parsed);
    expect(final).toHaveLength(3);
    expect(final[0]!.purchasedIds[0]).toBe("p1");
    expect(final[1]!.purchasedIds[0]).toBe("p2");
    expect(final[2]!.kind).toBe("unmatched");
  });

  it("mantém várias compras no mesmo vendido e não as reusa em outro", () => {
    const final = finalizeAiAssignments(
      ["s1", "s2"],
      [
        {
          soldId: "s1",
          kind: "same_item",
          purchasedIds: ["p1", "p2"],
          ingredientLabels: {},
          confidence: 0.95,
          reasonPt: "Mesma cerveja, dois fornecedores",
        },
        {
          soldId: "s2",
          kind: "same_item",
          purchasedIds: ["p1"],
          ingredientLabels: {},
          confidence: 0.8,
          reasonPt: "também parece heineken",
        },
      ],
    );
    expect(final[0]!.purchasedIds).toEqual(["p1", "p2"]);
    expect(final[1]!.kind).toBe("unmatched");
    expect(final[1]!.purchasedIds).toEqual([]);
  });

  it("mapeia ficha com insumos e deixa compras não usadas no residual", () => {
    const sold = [item("s1", "CAIPIRINHA", "sold_unlinked")];
    const purchased = [
      item("p1", "LIMAO TAHITI", "purchase_unlinked"),
      item("p2", "CACHACA 51", "purchase_unlinked"),
      item("p3", "PAPEL TOALHA", "purchase_unlinked"),
    ];
    const result = mapAiAssignmentsToValidationResult({
      sold,
      purchased,
      leftover: [],
      assignments: [
        {
          soldId: "s1",
          kind: "recipe",
          purchasedIds: ["p1", "p2"],
          ingredientLabels: { p1: "Limão", p2: "Cachaça" },
          confidence: 0.9,
          reasonPt: "Drink",
        },
      ],
    });
    expect(result.recipes).toHaveLength(1);
    expect(result.recipes[0]!.ingredients.map((i) => i.hintLabel)).toEqual([
      "Limão",
      "Cachaça",
    ]);
    expect(result.residual.map((r) => r.productId)).toEqual(["p3"]);
    expect(result.sameItem).toHaveLength(0);
  });

  it("só confirma e trava compra com 90% ou mais", () => {
    const sold = [
      item("s1", "HEINEKEN 600", "sold_unlinked"),
      item("s2", "SKOL 300", "sold_unlinked"),
    ];
    const purchased = [
      item("p1", "HEINEKEN 600ML", "purchase_unlinked"),
      item("p2", "SKOL LATA", "purchase_unlinked"),
    ];
    const result = mapAiAssignmentsToValidationResult({
      sold,
      purchased,
      leftover: [],
      assignments: [
        {
          soldId: "s1",
          kind: "same_item",
          purchasedIds: ["p1"],
          ingredientLabels: {},
          confidence: 0.96,
          reasonPt: "Mesma cerveja",
        },
        {
          soldId: "s2",
          kind: "same_item",
          purchasedIds: ["p2"],
          ingredientLabels: {},
          confidence: 0.7,
          reasonPt: "Talvez skol",
        },
      ],
    });
    expect(result.stats.sameItem).toBe(1);
    expect(result.sameItem.map((row) => row.band)).toEqual(["high", "review"]);
    expect(result.residual.map((row) => row.productId).sort()).toEqual([
      "p2",
      "s2",
    ]);
  });

  it("tira do residual todas as notas de um mesmo vendido high", () => {
    const result = mapAiAssignmentsToValidationResult({
      sold: [item("s1", "HEINEKEN 600", "sold_unlinked")],
      purchased: [
        item("p1", "HEINEKEN FORN A", "purchase_unlinked"),
        item("p2", "HEINEKEN FORN B", "purchase_unlinked"),
        item("p3", "AGUA", "purchase_unlinked"),
      ],
      leftover: [],
      assignments: [
        {
          soldId: "s1",
          kind: "same_item",
          purchasedIds: ["p1", "p2"],
          ingredientLabels: {},
          confidence: 0.94,
          reasonPt: "Dois cadastros da mesma cerveja",
        },
      ],
    });
    expect(result.sameItem[0]!.candidates.map((c) => c.purchase.productId)).toEqual(
      ["p1", "p2"],
    );
    expect(result.residual.map((row) => row.productId)).toEqual(["p3"]);
  });
});

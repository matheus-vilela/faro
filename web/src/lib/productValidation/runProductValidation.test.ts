import { describe, expect, it } from "vitest";
import type { ProductSetupItem } from "@/lib/productSetupQueue";
import { scoreEpocToNfeName } from "@/lib/productValidation/nameMatch";
import { runProductValidation } from "@/lib/productValidation/runProductValidation";

function sold(
  id: string,
  name: string,
  kind: ProductSetupItem["kind"] = "sold_unlinked",
): ProductSetupItem {
  return {
    key: `sold:${id}`,
    productId: id,
    name,
    unit: "un",
    quantity: 0,
    kind,
    sourceLabel: "PDV (EPOC)",
    pendingQuestion: "",
  };
}

function purchase(id: string, name: string): ProductSetupItem {
  return {
    key: `purchase:${id}`,
    productId: id,
    name,
    unit: "un",
    quantity: 10,
    kind: "purchase_unlinked",
    sourceLabel: "Nota / compra",
    pendingQuestion: "",
  };
}

describe("scoreEpocToNfeName", () => {
  it("casa Heineken 600 do PDV com a linha abreviada da nota", () => {
    const r = scoreEpocToNfeName("HEINEKEN 600", "CERV HEINEKEN LN 600ML");
    expect(r.score).toBeGreaterThanOrEqual(85);
  });

  it("não trata 330 e 600 como o mesmo item", () => {
    const r = scoreEpocToNfeName("HEINEKEN 330", "CERV HEINEKEN 600ML");
    expect(r.score).toBeLessThan(55);
  });

  it("não sobe água genérica do PDV para marca da nota", () => {
    const r = scoreEpocToNfeName(
      "AGUA COM GAS",
      "AGUA MINERAL CRYSTAL COM GAS 500ML",
    );
    expect(r.score).toBeLessThan(85);
  });
});

describe("runProductValidation", () => {
  it("sugere o mesmo item só por nome entre EPOC e nota", () => {
    const result = runProductValidation({
      items: [
        sold("s1", "HEINEKEN 600"),
        purchase("p1", "CERV HEINEKEN LN 600ML CX 12"),
        purchase("p2", "LIMAO TAHITI KG"),
      ],
    });
    expect(result.sameItem).toHaveLength(1);
    expect(result.sameItem[0]!.sold.productId).toBe("s1");
    expect(result.sameItem[0]!.candidates[0]!.purchase.productId).toBe("p1");
    expect(result.sameItem[0]!.band).toBe("high");
  });

  it("não cruza duas compras entre si", () => {
    const result = runProductValidation({
      items: [
        purchase("p1", "CERV HEINEKEN 600ML"),
        purchase("p2", "CERVEJA HEINEKEN 600 ML"),
      ],
    });
    expect(result.sameItem).toHaveLength(0);
    expect(result.recipes).toHaveLength(0);
  });

  it("trata caipirinha como ficha e limão/cachaça como insumos, não como o mesmo item", () => {
    const result = runProductValidation({
      items: [
        sold("s1", "CAIPIRINHA"),
        purchase("p1", "LIMAO TAHITI KG"),
        purchase("p2", "CACHACA 51 1L"),
        purchase("p3", "ACUCAR CRISTAL 1KG"),
      ],
    });
    expect(result.sameItem).toHaveLength(0);
    expect(result.recipes).toHaveLength(1);
    const recipe = result.recipes[0]!;
    expect(recipe.sold.productId).toBe("s1");
    const hintKeys = recipe.ingredients.map((i) => i.hintKey).sort();
    expect(hintKeys).toContain("limao");
    expect(hintKeys).toContain("cachaca");
    expect(hintKeys).toContain("acucar");
  });
});

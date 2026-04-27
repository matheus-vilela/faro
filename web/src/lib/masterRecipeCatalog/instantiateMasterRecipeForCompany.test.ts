import { describe, expect, it } from "vitest";
import { masterRecipeDefinitionByExternalKey } from "@/lib/masterRecipeCatalog/seedRegistry";
import {
  flattenMasterRecipeDefinition,
  mergeFlattenedLines,
  mergeRpcIngredientRowsByProduct,
} from "@/lib/masterRecipeCatalog/instantiateMasterRecipeForCompany";

describe("flattenMasterRecipeDefinition", () => {
  it("expande caipivodka com sub-receita caipirinha", () => {
    const def = masterRecipeDefinitionByExternalKey("mr-drink-caipivodka");
    expect(def).toBeTruthy();
    const flat = mergeFlattenedLines(flattenMasterRecipeDefinition(def!, 1, new Set(), 0));
    expect(flat.length).toBeGreaterThan(1);
    const ids = new Set(flat.map((f) => f.masterItemId));
    expect(ids.has("mc-beb-destilados")).toBe(true);
    expect(ids.has("mc-ins-horti-mercado")).toBe(true);
  });
});

describe("mergeRpcIngredientRowsByProduct", () => {
  it("soma quantidades quando dois insumos resolvem para o mesmo produto", () => {
    const merged = mergeRpcIngredientRowsByProduct([
      {
        product_id: "a",
        quantity: 0.1,
        input_quantity: 0.1,
        input_unit_code: "kg",
        loss_factor: 1.05,
        sort_order: 1,
      },
      {
        product_id: "a",
        quantity: 0.2,
        input_quantity: 0.2,
        input_unit_code: "kg",
        loss_factor: 1.08,
        sort_order: 2,
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.quantity).toBeCloseTo(0.3);
    expect(merged[0]!.loss_factor).toBe(1.08);
  });
});

import { describe, expect, it } from "vitest";
import { suggestMasterRecipeTemplate } from "@/lib/masterRecipeCatalog/suggestMasterRecipeTemplate";

describe("master recipe suggestions", () => {
  it("Caipirinha -> sugerir drink recipe", () => {
    const s = suggestMasterRecipeTemplate("Caipirinha tradicional");
    expect(s?.recipeType).toBe("DRINK_RECIPE");
  });

  it("Caipivodka -> sugerir drink recipe", () => {
    const s = suggestMasterRecipeTemplate("CAIPIVODKA");
    expect(s?.recipeType).toBe("DRINK_RECIPE");
  });

  it("Gin Tônica -> sugerir drink recipe", () => {
    const s = suggestMasterRecipeTemplate("Gin Tônica");
    expect(s?.recipeType).toBe("DRINK_RECIPE");
  });

  it("Xarope Simples -> sugerir base/sub-recipe", () => {
    const s = suggestMasterRecipeTemplate("Xarope Simples");
    expect(s?.recipeType).toBe("SAUCE_BASE_RECIPE");
  });

  it("Molho da Casa -> sugerir prep/sub-recipe", () => {
    const s = suggestMasterRecipeTemplate("Molho da Casa");
    expect(s?.recipeType).toBe("SUB_RECIPE");
  });

  it("Arroz Base -> sugerir prep recipe", () => {
    const s = suggestMasterRecipeTemplate("Arroz Base");
    expect(s?.recipeType).toBe("PREP_RECIPE");
  });

  it("Massa de Pizza -> sugerir prep recipe", () => {
    const s = suggestMasterRecipeTemplate("Massa de Pizza");
    expect(s?.recipeType).toBe("PREP_RECIPE");
  });

  it("IPA Lata 473ml -> não sugerir ficha", () => {
    expect(suggestMasterRecipeTemplate("IPA Lata 473ml")).toBeNull();
  });

  it("Pilsen 600ml -> não sugerir ficha", () => {
    expect(suggestMasterRecipeTemplate("Pilsen 600ml")).toBeNull();
  });

  it("Monitor LED 24 -> não sugerir ficha", () => {
    expect(suggestMasterRecipeTemplate("Monitor LED 24")).toBeNull();
  });

  it("Detergente 5L -> não sugerir ficha", () => {
    expect(suggestMasterRecipeTemplate("Detergente 5L")).toBeNull();
  });

  it("ficha com sub-receita -> funcionar corretamente", () => {
    const s = suggestMasterRecipeTemplate("Caipivodka");
    expect(s?.componentHints.some((c) => c.componentKind === "MASTER_RECIPE")).toBe(true);
  });

  it("Mojito -> sugerir drink recipe", () => {
    const s = suggestMasterRecipeTemplate("Mojito");
    expect(s?.recipeType).toBe("DRINK_RECIPE");
    expect(s?.masterRecipeId).toBe("mr-drink-mojito");
  });

  it("Moscow Mule -> sugerir drink recipe", () => {
    const s = suggestMasterRecipeTemplate("Moscow Mule");
    expect(s?.recipeType).toBe("DRINK_RECIPE");
    expect(s?.masterRecipeId).toBe("mr-drink-moscow-mule");
  });

  it("Feijão base -> sugerir prep recipe", () => {
    const s = suggestMasterRecipeTemplate("Feijão base cozido");
    expect(s?.recipeType).toBe("PREP_RECIPE");
  });

  it("Maionese -> sugerir prep recipe", () => {
    const s = suggestMasterRecipeTemplate("Maionese da casa");
    expect(s?.recipeType).toBe("PREP_RECIPE");
  });
});

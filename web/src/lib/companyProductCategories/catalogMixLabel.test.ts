import { describe, expect, it } from "vitest";
import {
  SEM_GRUPO_LABEL,
  catalogMixLabelForSale,
  pickCatalogMixCategory,
  type CatalogMixCategory,
} from "./catalogMixLabel";

function cat(
  partial: Partial<CatalogMixCategory> & Pick<CatalogMixCategory, "id" | "name">,
): CatalogMixCategory {
  return {
    sort_order: 0,
    ...partial,
  };
}

describe("pickCatalogMixCategory", () => {
  it("escolhe a de menor sort_order e ignora exclude_from_sales", () => {
    const picked = pickCatalogMixCategory([
      cat({ id: "gas", name: "Gás", sort_order: 0, exclude_from_sales: true }),
      cat({ id: "soft", name: "Soft Drink", sort_order: 15 }),
      cat({ id: "cerv", name: "Cervejas", sort_order: 13 }),
    ]);
    expect(picked?.name).toBe("Cervejas");
  });

  it("desempata por nome quando o sort_order empata", () => {
    const picked = pickCatalogMixCategory([
      cat({ id: "b", name: "Vinhos", sort_order: 1 }),
      cat({ id: "a", name: "Cervejas", sort_order: 1 }),
    ]);
    expect(picked?.name).toBe("Cervejas");
  });
});

describe("catalogMixLabelForSale", () => {
  const cervejas = cat({ id: "cerv", name: "Cervejas", sort_order: 13 });
  const soft = cat({ id: "soft", name: "Soft Drink", sort_order: 15 });
  const byProduct = new Map([
    ["heineken", [cervejas]],
    ["coca", [soft]],
    [
      "prato-out",
      [cat({ id: "salg", name: "Salgados e Pré Prontos", sort_order: 1 })],
    ],
  ]);
  const recipeOut = new Map<string, string | null>([
    ["caipirinha", "prato-out"],
    ["sem-saida", null],
  ]);

  it("HEINEKEN vai para Cervejas", () => {
    expect(
      catalogMixLabelForSale(
        { entry_mode: "product_sale", product_id: "heineken" },
        byProduct,
        recipeOut,
      ),
    ).toBe("Cervejas");
  });

  it("Coca vai para Soft Drink", () => {
    expect(
      catalogMixLabelForSale(
        { entry_mode: "product_sale", product_id: "coca" },
        byProduct,
        recipeOut,
      ),
    ).toBe("Soft Drink");
  });

  it("ficha usa o produto de saída", () => {
    expect(
      catalogMixLabelForSale(
        { entry_mode: "recipe_sale", recipe_id: "caipirinha" },
        byProduct,
        recipeOut,
      ),
    ).toBe("Salgados e Pré Prontos");
  });

  it("sem tag ou ficha sem saída vira Sem grupo", () => {
    expect(
      catalogMixLabelForSale(
        { entry_mode: "product_sale", product_id: "orphan" },
        byProduct,
        recipeOut,
      ),
    ).toBe(SEM_GRUPO_LABEL);
    expect(
      catalogMixLabelForSale(
        { entry_mode: "recipe_sale", recipe_id: "sem-saida" },
        byProduct,
        recipeOut,
      ),
    ).toBe(SEM_GRUPO_LABEL);
    expect(
      catalogMixLabelForSale(
        { entry_mode: "manual" },
        byProduct,
        recipeOut,
      ),
    ).toBe(SEM_GRUPO_LABEL);
  });
});

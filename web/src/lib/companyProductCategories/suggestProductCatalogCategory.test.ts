import { describe, expect, it } from "vitest";
import { suggestProductCatalogCategory } from "./suggestProductCatalogCategory";
import type { CompanyProductCategory } from "@/types/companyProductCategory";

function cat(id: string, name: string): CompanyProductCategory {
  return {
    id,
    company_id: "c1",
    name,
    sort_order: 0,
    created_at: "",
    updated_at: "",
  };
}

const SEED_LIKE: CompanyProductCategory[] = [
  cat("1", "Bebidas"),
  cat("2", "Cervejas"),
  cat("3", "Cozinha"),
  cat("4", "Diversos"),
  cat("5", "COCA XPTO LATA 350ml"),
].map((c, i) => ({ ...c, sort_order: i }));

describe("suggestProductCatalogCategory", () => {
  it("usa nome do item (bebida) antes do tipo", () => {
    const r = suggestProductCatalogCategory({
      categories: SEED_LIKE,
      operationalType: "INSUMO",
      productName: "Refrigerante cola 2L",
    });
    expect(r).not.toBeNull();
    expect(r!.category.id).toBe("1");
    expect(r!.source).toBe("product_name");
  });

  it("mapeia tipo insumo para categoria alinhada (cozinha)", () => {
    const r = suggestProductCatalogCategory({
      categories: SEED_LIKE,
      operationalType: "INSUMO",
      productName: "produto xpto sem sinal de bebida",
    });
    expect(r?.category.id).toBe("3");
    expect(r?.source).toBe("operational_type");
  });

  it("cai em Diversos quando nada bate e existe", () => {
    const r = suggestProductCatalogCategory({
      categories: [cat("9", "Outra"), cat("4", "Diversos")],
      operationalType: "PRODUTO_REVENDA",
      productName: "asdf zxcv 1234",
    });
    expect(r?.category.id).toBe("4");
    expect(r?.source).toBe("fallback");
  });
});

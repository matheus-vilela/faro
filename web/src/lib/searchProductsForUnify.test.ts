import { describe, expect, it } from "vitest";
import { productMatchesUnifySearch } from "@/lib/searchProductsForUnify";

describe("productMatchesUnifySearch", () => {
  const product = {
    name: "Coca-Cola 350ml",
    sku: "COCA350",
    ean: "789123",
    barcode: null,
    merged_catalog_names: ["Coca Lata", "Refri Coca"],
  };

  it("acha pelo nome do catálogo", () => {
    expect(productMatchesUnifySearch(product, "coca-cola")).toBe(true);
  });

  it("acha pelo nome já unificado", () => {
    expect(productMatchesUnifySearch(product, "lata")).toBe(true);
  });

  it("rejeita termo que não existe", () => {
    expect(productMatchesUnifySearch(product, "pepsi")).toBe(false);
  });
});

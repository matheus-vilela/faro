import { describe, expect, it } from "vitest";
import {
  previewEpocProdutoVendasInterpret,
} from "@/lib/epocProdutoVendasInterpret";

const CSV = `data_consumo;Produto;Quant.;Total recebido(R$)
30/07/2026;Agua com gas;2;20,00
30/07/2026;Novo Item;1;15,50
29/07/2026;Agua com gas;1;10,00
29/07/2026;;1;5,00
28/07/2026;Agua com gas;x;10,00
`;

describe("previewEpocProdutoVendasInterpret", () => {
  it("agrega por dia/produto e classifica criar vs existente", () => {
    const preview = previewEpocProdutoVendasInterpret(CSV, "teste.csv", {
      products: [
        { id: "p1", name: "Água com gás", unit: "un", is_active: true },
      ],
      recipes: [],
    });

    expect(preview.ok).toBe(true);
    expect(preview.totals.validLines).toBe(3);
    expect(preview.totals.skippedLines).toBe(2);
    expect(preview.totals.wouldMatchProducts).toBe(1);
    expect(preview.totals.wouldCreateProducts).toBe(1);
    expect(preview.totals.totalRecebido).toBeCloseTo(45.5);
    expect(preview.days).toHaveLength(2);
    expect(preview.products.find((p) => p.catalogAction === "match_product")?.quantity).toBe(3);
    expect(preview.products.find((p) => p.catalogAction === "create_product")?.productName).toBe(
      "Novo Item",
    );
  });

  it("falha sem coluna data_consumo", () => {
    const preview = previewEpocProdutoVendasInterpret(
      "Produto;Quant.;Total recebido(R$)\nA;1;1,00\n",
      "bad.csv",
      { products: [], recipes: [] },
    );
    expect(preview.ok).toBe(false);
    expect(preview.error).toMatch(/data_consumo/i);
  });
});

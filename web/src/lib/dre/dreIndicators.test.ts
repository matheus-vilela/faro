import { describe, expect, it } from "vitest";
import type { CompanyCategory } from "@/types/category";
import { buildDreComputedFromMaps } from "./computeDre";
import {
  margemContribuicao,
  pontoEquilibrioReceita,
  porCemReaisVendasLiquidas,
  taxaMargemContribuicao,
} from "./dreIndicators";

function cat(
  id: string,
  natureza: CompanyCategory["natureza"],
  tipo: CompanyCategory["tipo"],
  extra?: Partial<CompanyCategory>,
): CompanyCategory {
  return {
    id,
    company_id: "c1",
    parent_id: null,
    name: id,
    sort_order: 0,
    ordem: 0,
    created_at: "",
    updated_at: "",
    natureza,
    tipo,
    incluir_no_dre: true,
    ...extra,
  };
}

describe("dreIndicators", () => {
  it("calcula sobra, PE e por R$100 alinhados ao cenário de buildDreComputedFromMaps", () => {
    const categories = [
      cat("r1", "RECEITA", "OPERACIONAL"),
      cat("r2", "RECEITA", "OPERACIONAL", { papel_receita_dre: "DEDUCAO" }),
      cat("cmv1", "DESPESA", "CMV"),
      cat("v1", "DESPESA", "VARIAVEL"),
      cat("f1", "DESPESA", "FIXA"),
      cat("nr1", "RECEITA", "NAO_OPERACIONAL"),
      cat("inv1", "DESPESA", "INVESTIMENTOS_FINANCIAMENTOS"),
      cat("imp1", "DESPESA", "IMPOSTOS"),
    ];
    const byId = new Map(categories.map((c) => [c.id, c]));
    const byCategoryId = new Map<string, number>([
      ["r1", 1000],
      ["r2", 100],
      ["cmv1", 200],
      ["v1", 50],
      ["f1", 300],
      ["nr1", 40],
      ["inv1", 60],
      ["imp1", 10],
    ]);
    const computed = buildDreComputedFromMaps(byCategoryId, byId);

    expect(computed.vendasLiquidas).toBe(900);
    const mc = margemContribuicao(computed);
    expect(mc).toBe(650);

    const pe = pontoEquilibrioReceita(computed);
    expect(pe.reason).toBe("ok");
    expect(pe.value).toBeCloseTo((300 * 900) / 650, 6);

    expect(taxaMargemContribuicao(computed)).toBeCloseTo(650 / 900, 10);

    const por100 = porCemReaisVendasLiquidas(computed);
    expect(por100.cmv).toBeCloseTo((200 / 900) * 100, 6);
    expect(por100.despesasVariaveis).toBeCloseTo((50 / 900) * 100, 6);
    expect(por100.despesasFixas).toBeCloseTo((300 / 900) * 100, 6);
    expect(por100.despesasOperacionais).toBeCloseTo((350 / 900) * 100, 6);
    expect(por100.margemContribuicao).toBeCloseTo((650 / 900) * 100, 6);
    expect(por100.resultadoOperacional).toBeCloseTo((350 / 900) * 100, 6);
    expect(por100.resultadoFinanceiroLiquido).toBeCloseTo((-20 / 900) * 100, 6);
    expect(por100.impostos).toBeCloseTo((10 / 900) * 100, 6);
    expect(por100.lucroLiquido).toBeCloseTo((320 / 900) * 100, 6);
  });

  it("PE sem vendas líquidas", () => {
    const computed = buildDreComputedFromMaps(new Map(), new Map());
    const pe = pontoEquilibrioReceita(computed);
    expect(pe.reason).toBe("no_sales");
    expect(pe.value).toBe(0);
  });
});

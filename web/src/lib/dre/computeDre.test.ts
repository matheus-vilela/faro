import { describe, expect, it } from "vitest";
import type { CompanyCategory } from "@/types/category";
import { computeDreLines, buildDreComputedFromMaps } from "./computeDre";

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

describe("computeDreLines", () => {
  it("aplica as fórmulas obrigatórias", () => {
    const r = computeDreLines({
      vendasBrutas: 10_000,
      deducoesReceita: 500,
      cmv: 3_000,
      despesasVariaveis: 800,
      despesasFixas: 2_000,
      resultadoFinanceiroReceitas: 100,
      resultadoFinanceiroDespesas: 200,
      impostos: 150,
    });
    expect(r.vendasLiquidas).toBe(9_500);
    expect(r.lucroBruto).toBe(6_500);
    expect(r.resultadoOperacional).toBe(3_700);
    expect(r.resultadoFinanceiroLiquido).toBe(-100);
    expect(r.resultadoAntesImposto).toBe(3_600);
    expect(r.lucroLiquido).toBe(3_450);
  });
});

describe("buildDreComputedFromMaps", () => {
  it("agrega por categoria e calcula o consolidado", () => {
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
    const r = buildDreComputedFromMaps(byCategoryId, byId);
    expect(r.vendasBrutas).toBe(1000);
    expect(r.deducoesReceita).toBe(100);
    expect(r.vendasLiquidas).toBe(900);
    expect(r.cmv).toBe(200);
    expect(r.lucroBruto).toBe(700);
    expect(r.resultadoOperacional).toBe(350);
    expect(r.resultadoFinanceiroLiquido).toBe(-20);
    expect(r.resultadoAntesImposto).toBe(330);
    expect(r.lucroLiquido).toBe(320);
  });
});

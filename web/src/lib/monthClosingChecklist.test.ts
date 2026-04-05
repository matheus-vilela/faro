import { describe, expect, it } from "vitest";
import {
  buildChecklistItems,
  countDone,
  defaultItemStatusForAmount,
  deriveClosingChecklistAmounts,
  monthKeyFromPeriod,
} from "./monthClosingChecklist";
import type { DreComputed } from "./dre/computeDre";
import type { CategoryTotals } from "./dre/computeDre";
import type { CompanyCategory } from "@/types/category";

function emptyTotals(): CategoryTotals {
  return {
    byCategoryId: new Map(),
    unmappedCategoryIds: new Set(),
    unmappedTotal: 0,
    semCategoriaCount: 0,
    semCategoriaTotal: 0,
  };
}

function sampleComputed(partial: Partial<DreComputed>): DreComputed {
  return {
    vendasBrutas: partial.vendasBrutas ?? 0,
    deducoesReceita: partial.deducoesReceita ?? 0,
    vendasLiquidas: partial.vendasLiquidas ?? 0,
    cmv: partial.cmv ?? 0,
    lucroBruto: partial.lucroBruto ?? 0,
    despesasVariaveis: partial.despesasVariaveis ?? 0,
    despesasFixas: partial.despesasFixas ?? 0,
    resultadoOperacional: partial.resultadoOperacional ?? 0,
    resultadoFinanceiroReceitas: partial.resultadoFinanceiroReceitas ?? 0,
    resultadoFinanceiroDespesas: partial.resultadoFinanceiroDespesas ?? 0,
    resultadoFinanceiroLiquido: partial.resultadoFinanceiroLiquido ?? 0,
    resultadoAntesImposto: partial.resultadoAntesImposto ?? 0,
    impostos: partial.impostos ?? 0,
    lucroLiquido: partial.lucroLiquido ?? 0,
  };
}

describe("monthClosingChecklist", () => {
  it("monthKeyFromPeriod formats YYYY-MM", () => {
    expect(monthKeyFromPeriod({ month: 4, year: 2026 })).toBe("2026-04");
    expect(monthKeyFromPeriod({ month: 12, year: 2025 })).toBe("2025-12");
  });

  it("deriveClosingChecklistAmounts maps DRE lines", () => {
    const computed = sampleComputed({
      vendasLiquidas: 1000,
      impostos: 50,
      cmv: 200,
    });
    const totals = emptyTotals();
    const amounts = deriveClosingChecklistAmounts(computed, totals, []);
    expect(amounts.vendas).toBe(1000);
    expect(amounts.impostos).toBe(50);
    expect(amounts.compras).toBe(200);
    expect(amounts.equipe).toBe(0);
    expect(amounts.espaco).toBe(0);
  });

  it("deriveClosingChecklistAmounts splits fixas by name heuristics", () => {
    const computed = sampleComputed({});
    const catFolha: CompanyCategory = {
      id: "c1",
      company_id: "co",
      parent_id: null,
      name: "Folha de pagamento",
      sort_order: 0,
      created_at: "",
      updated_at: "",
      natureza: "DESPESA",
      tipo: "FIXA",
    };
    const catAluguel: CompanyCategory = {
      id: "c2",
      company_id: "co",
      parent_id: null,
      name: "Aluguel",
      sort_order: 0,
      created_at: "",
      updated_at: "",
      natureza: "DESPESA",
      tipo: "FIXA",
    };
    const totals: CategoryTotals = {
      ...emptyTotals(),
      byCategoryId: new Map([
        ["c1", -3000],
        ["c2", -2500],
      ]),
    };
    const amounts = deriveClosingChecklistAmounts(computed, totals, [catFolha, catAluguel]);
    expect(amounts.equipe).toBe(3000);
    expect(amounts.espaco).toBe(2500);
  });

  it("defaultItemStatusForAmount distinguishes zero vs value", () => {
    expect(defaultItemStatusForAmount(0)).toBe("missing");
    expect(defaultItemStatusForAmount(10)).toBe("pending");
  });

  it("countDone counts terminal states", () => {
    const items = buildChecklistItems(
      {
        vendas: 1,
        equipe: 0,
        espaco: 0,
        impostos: 0,
        compras: 0,
      },
      null,
      false,
    );
    expect(countDone(items)).toBe(0);
    const confirmed = items.map((it) =>
      it.id === "vendas"
        ? { ...it, status: "confirmed" as const }
        : it,
    );
    expect(countDone(confirmed)).toBe(1);
  });

  it("buildChecklistItems forces green when month is closed", () => {
    const items = buildChecklistItems(
      {
        vendas: 0,
        equipe: 0,
        espaco: 0,
        impostos: 0,
        compras: 0,
      },
      null,
      true,
    );
    for (const it of items) {
      expect(it.status === "confirmed" || it.status === "no_value_confirmed").toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  dreHasMappedMovement,
  dreHasOnlyUnclassified,
  lucroLiquidoGerencial,
} from "./dreMovement";
import {
  estimateBreakEvenDay,
  momPercent,
  projectMonthEndLucro,
  shiftMonth,
} from "./dreInsight";
import type { DreComputed } from "./computeDre";
import type { CategoryTotals } from "./computeDre";

const emptyTotals: CategoryTotals = {
  byCategoryId: new Map(),
  unmappedCategoryIds: new Set(),
  unmappedTotal: 0,
  semCategoriaCount: 0,
  semCategoriaTotal: 0,
};

const zeroComputed: DreComputed = {
  vendasBrutas: 0,
  deducoesReceita: 0,
  vendasLiquidas: 0,
  cmv: 0,
  lucroBruto: 0,
  despesasVariaveis: 0,
  despesasFixas: 0,
  resultadoOperacional: 0,
  resultadoFinanceiroReceitas: 0,
  resultadoFinanceiroDespesas: 0,
  resultadoFinanceiroLiquido: 0,
  resultadoAntesImposto: 0,
  impostos: 0,
  lucroLiquido: 0,
};

describe("dreMovement", () => {
  it("detecta só não classificados", () => {
    expect(dreHasMappedMovement(zeroComputed, 0, emptyTotals)).toBe(false);
    expect(dreHasOnlyUnclassified(5, false, 5)).toBe(true);
    expect(dreHasOnlyUnclassified(0, false, 0)).toBe(false);
  });

  it("lucro gerencial desconta sem categoria", () => {
    expect(lucroLiquidoGerencial(9000, 1000)).toBe(8000);
  });
});

describe("dreInsight helpers", () => {
  it("shiftMonth e momPercent", () => {
    expect(shiftMonth({ month: 1, year: 2026 }, -1)).toEqual({
      month: 12,
      year: 2025,
    });
    expect(momPercent(110, 100)).toBeCloseTo(10);
    expect(momPercent(50, 0)).toBeNull();
  });

  it("estima dia de break-even", () => {
    const computed: DreComputed = {
      ...zeroComputed,
      vendasLiquidas: 60000,
      lucroBruto: 40000,
      despesasVariaveis: 0,
      despesasFixas: 30000,
      cmv: 20000,
    };
    // PE = 30000 / (40000/60000) = 45000 → day = ceil(45000/60000*31)
    const day = estimateBreakEvenDay(computed, { month: 7, year: 2026 });
    expect(day).toBe(24);
  });

  it("projeta fim do mês", () => {
    const result = projectMonthEndLucro(9000, { month: 7, year: 2026 }, new Date(2026, 6, 15));
    expect(result?.daysLeft).toBe(16);
    expect(result?.projected).toBeCloseTo(18600);
  });
});

import type { DreComputed } from "./computeDre";

/** Margem de contribuição total (vendas líquidas − CMV − despesas variáveis). */
export function margemContribuicao(computed: DreComputed): number {
  return computed.lucroBruto - computed.despesasVariaveis;
}

export type PontoEquilibrioReason = "ok" | "no_sales" | "nonpositive_mc";

/**
 * Faturamento de equilíbrio (receita em que a margem de contribuição cobre as despesas fixas).
 * PE = despesasFixas / (margemContribuição / vendasLiquidas).
 */
export function pontoEquilibrioReceita(computed: DreComputed): {
  value: number;
  reason: PontoEquilibrioReason;
} {
  const vl = computed.vendasLiquidas;
  if (vl <= 0) {
    return { value: 0, reason: "no_sales" };
  }
  const mc = margemContribuicao(computed);
  if (mc <= 0) {
    return { value: 0, reason: "nonpositive_mc" };
  }
  return {
    value: (computed.despesasFixas * vl) / mc,
    reason: "ok",
  };
}

/** Valores em R$ por cada R$100 de vendas líquidas (análise vertical). */
export interface PorCemReaisVendasLiquidas {
  cmv: number;
  despesasVariaveis: number;
  despesasFixas: number;
  /** Despesas variáveis + fixas. */
  despesasOperacionais: number;
  margemContribuicao: number;
  resultadoOperacional: number;
  resultadoFinanceiroLiquido: number;
  impostos: number;
  lucroLiquido: number;
}

export function porCemReaisVendasLiquidas(computed: DreComputed): PorCemReaisVendasLiquidas {
  const vl = computed.vendasLiquidas;
  if (vl <= 0) {
    return {
      cmv: 0,
      despesasVariaveis: 0,
      despesasFixas: 0,
      despesasOperacionais: 0,
      margemContribuicao: 0,
      resultadoOperacional: 0,
      resultadoFinanceiroLiquido: 0,
      impostos: 0,
      lucroLiquido: 0,
    };
  }
  const f = 100 / vl;
  const mc = margemContribuicao(computed);
  const dv = computed.despesasVariaveis;
  const df = computed.despesasFixas;
  return {
    cmv: computed.cmv * f,
    despesasVariaveis: dv * f,
    despesasFixas: df * f,
    despesasOperacionais: (dv + df) * f,
    margemContribuicao: mc * f,
    resultadoOperacional: computed.resultadoOperacional * f,
    resultadoFinanceiroLiquido: computed.resultadoFinanceiroLiquido * f,
    impostos: computed.impostos * f,
    lucroLiquido: computed.lucroLiquido * f,
  };
}

/** Taxa de margem de contribuição sobre vendas líquidas (0–1); 0 se não houver base. */
export function taxaMargemContribuicao(computed: DreComputed): number {
  const vl = computed.vendasLiquidas;
  if (vl <= 0) return 0;
  return margemContribuicao(computed) / vl;
}

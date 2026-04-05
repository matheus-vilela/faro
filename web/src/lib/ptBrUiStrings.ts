/**
 * Cópias com escapes Unicode para evitar mojibake nos acentos quando o
 * arquivo-fonte é salvo ou interpretado com encoding incorreto no Windows.
 */
export const ptBrUi = {
  dre: {
    regrasClassificacao:
      "As receitas operacionais (incluindo vendas de produto) entram no DRE pela categoria da venda escolhida no lan\u00e7amento. O CMV \u00e9 agrupado pela categoria de despesa (CMV) cadastrada em cada produto vendido.",
    resumoAnaliticoDesc:
      "Receitas em verde, dedu\u00e7\u00f5es em \u00e2mbar, custos e despesas em vermelho, resultados em destaque.",
    deducoesReceitaLabel:
      "Dedu\u00e7\u00f5es da receita / despesas sobre vendas",
  },
  receitas: {
    deducoesFaturamento: "Dedu\u00e7\u00f5es de faturamento",
  },
  configuracoesCategorias: {
    deducaoReceitaSelectItem: "Dedu\u00e7\u00e3o da receita (contra-receita)",
    deducoesHelp:
      "Use dedu\u00e7\u00f5es para descontos, devolu\u00e7\u00f5es e impostos incidentes sobre vendas que reduzem a receita bruta.",
  },
} as const;

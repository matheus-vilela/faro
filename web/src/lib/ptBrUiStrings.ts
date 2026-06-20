/**
 * Cópias com escapes Unicode para evitar mojibake nos acentos quando o
 * arquivo-fonte é salvo ou interpretado com encoding incorreto no Windows.
 */
export const ptBrUi = {
  dre: {
    regrasClassificacao:
      "Receitas e dedu\u00e7\u00f5es entram no DRE pelo vencimento dos boletos; o CMV das vendas \u00e9 somado pela data da receita, com custo gravado em cada venda (produto ou ingredientes da ficha).",
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

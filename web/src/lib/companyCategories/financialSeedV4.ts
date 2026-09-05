import type {
  NaturezaCategoria,
  PapelReceitaDre,
  TipoCategoria,
} from "@/types/category";

export type FinancialSeedV4Account = {
  name: string;
  natureza: NaturezaCategoria;
  tipo: TipoCategoria;
  papel_receita_dre: PapelReceitaDre | null;
  incluir_no_dre: boolean;
  ordem: number;
};

/** Plano de 11 contas do DRE (estabelecimento novo). */
export const FINANCIAL_SEED_V4: readonly FinancialSeedV4Account[] = [
  {
    name: "Receita Bruta de Vendas",
    natureza: "RECEITA",
    tipo: "OPERACIONAL",
    papel_receita_dre: "BRUTA",
    incluir_no_dre: true,
    ordem: 10,
  },
  {
    name: "Outras Receitas",
    natureza: "RECEITA",
    tipo: "NAO_OPERACIONAL",
    papel_receita_dre: null,
    incluir_no_dre: true,
    ordem: 20,
  },
  {
    name: "Deduções de Receita",
    natureza: "RECEITA",
    tipo: "OPERACIONAL",
    papel_receita_dre: "DEDUCAO",
    incluir_no_dre: true,
    ordem: 30,
  },
  {
    name: "Impostos",
    natureza: "DESPESA",
    tipo: "IMPOSTOS",
    papel_receita_dre: null,
    incluir_no_dre: true,
    ordem: 40,
  },
  {
    name: "Outros Tributos",
    natureza: "DESPESA",
    tipo: "IMPOSTOS",
    papel_receita_dre: null,
    incluir_no_dre: true,
    ordem: 50,
  },
  {
    name: "Despesas de Vendas e Marketing",
    natureza: "DESPESA",
    tipo: "FIXA",
    papel_receita_dre: null,
    incluir_no_dre: true,
    ordem: 60,
  },
  {
    name: "Despesas com Pessoal",
    natureza: "DESPESA",
    tipo: "FIXA",
    papel_receita_dre: null,
    incluir_no_dre: true,
    ordem: 70,
  },
  {
    name: "Despesas Administrativas",
    natureza: "DESPESA",
    tipo: "FIXA",
    papel_receita_dre: null,
    incluir_no_dre: true,
    ordem: 80,
  },
  {
    name: "Despesas Variáveis",
    natureza: "DESPESA",
    tipo: "VARIAVEL",
    papel_receita_dre: null,
    incluir_no_dre: true,
    ordem: 90,
  },
  {
    name: "Despesas Financeiras",
    natureza: "DESPESA",
    tipo: "INVESTIMENTOS_FINANCIAMENTOS",
    papel_receita_dre: null,
    incluir_no_dre: true,
    ordem: 100,
  },
  {
    name: "Ativos",
    natureza: "DESPESA",
    tipo: "INVESTIMENTOS_FINANCIAMENTOS",
    papel_receita_dre: null,
    incluir_no_dre: false,
    ordem: 110,
  },
];

/** Folhas candidatas à Conta do DRE de comida/bebida (v4 folha, v3 folha). */
export const VARIABLE_DRE_LEAF_CANDIDATES = [
  "Despesas Variáveis",
  "Outras - Variáveis",
] as const;

/** Folhas candidatas à Conta do DRE de limpeza. */
export const ADMIN_DRE_LEAF_CANDIDATES = [
  "Despesas Administrativas",
  "Material e serviços de limpeza",
] as const;

export function pickExistingDreLeafName(
  existingLeafNames: readonly string[],
  candidates: readonly string[],
): string | null {
  const set = new Set(existingLeafNames);
  for (const name of candidates) {
    if (set.has(name)) return name;
  }
  return null;
}

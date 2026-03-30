import type { BoletoCategory } from "@/types/expense";

/** Labels para UI (cadastro, listas, resumo). */
export const BOLETO_CATEGORY_LABELS: Record<BoletoCategory, string> = {
  insumos: "Insumos / matéria-prima",
  fornecedores: "Fornecedores",
  custo_fixo: "Custo fixo",
  estabelecimento: "Estabelecimento",
  outros: "Outros",
};

/** Texto curto para calendário e espaços apertados. */
export const BOLETO_CATEGORY_SHORT: Record<BoletoCategory, string> = {
  insumos: "Insumos",
  fornecedores: "Fornec.",
  custo_fixo: "Fixo",
  estabelecimento: "Estab.",
  outros: "Outros",
};

export const BOLETO_CATEGORY_ORDER: BoletoCategory[] = [
  "insumos",
  "fornecedores",
  "custo_fixo",
  "estabelecimento",
  "outros",
];

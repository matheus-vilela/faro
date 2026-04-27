export const OPERATIONAL_ITEM_TYPES = [
  "INSUMO",
  "PRODUTO_REVENDA",
  "ITEM_OPERACIONAL",
  "RECEITA_FICHA",
  "NAO_ESTOCAVEL",
  "REVISAO_PENDENTE",
] as const;

export type OperationalItemType = (typeof OPERATIONAL_ITEM_TYPES)[number];

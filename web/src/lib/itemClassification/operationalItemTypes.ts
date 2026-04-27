/** Classificação operacional (onboarding / itens) — alinhada ao schema `product_operational_config`. */

export const OPERATIONAL_ITEM_TYPES = [
  "INSUMO",
  "PRODUTO_REVENDA",
  "ITEM_OPERACIONAL",
  "RECEITA_FICHA",
  "NAO_ESTOCAVEL",
  "REVISAO_PENDENTE",
] as const;

export type OperationalItemType = (typeof OPERATIONAL_ITEM_TYPES)[number];

export const CONFIGURATION_STATUSES = [
  "PENDENTE",
  "PARCIAL",
  "CONFIGURADO",
  "BLOQUEADO",
  "IGNORADO",
] as const;

export type ConfigurationStatus = (typeof CONFIGURATION_STATUSES)[number];

export const FINAL_DECISION_SOURCES = ["AUTO", "USER_CONFIRMED", "USER_EDITED"] as const;

export type FinalDecisionSource = (typeof FINAL_DECISION_SOURCES)[number];

/** Mapeamento para `products.stock_control_type` (persistido via RPC). */
export function mapOperationalTypeToStockControl(
  t: OperationalItemType,
): "DIRECT" | "RECIPE_CONTROLLED" | "COMPOSITE" | "SERVICE" {
  switch (t) {
    case "INSUMO":
    case "NAO_ESTOCAVEL":
      return "SERVICE";
    case "RECEITA_FICHA":
      return "RECIPE_CONTROLLED";
    case "PRODUTO_REVENDA":
    case "ITEM_OPERACIONAL":
    case "REVISAO_PENDENTE":
      return "DIRECT";
    default:
      return "DIRECT";
  }
}

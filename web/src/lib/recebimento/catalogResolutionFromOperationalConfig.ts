import type { OperationalItemType } from "@/lib/itemClassification/operationalItemTypes";

export type CatalogResolutionHint = {
  summary: string;
  import_stock_resolution: "DIRECT";
  resolved_recipe_id: string | null;
  import_nature: string;
  suggestion: string;
};

/**
 * Converte a decisão de onboarding em parâmetros da RPC
 * `update_expense_item_import_resolution_for_recebimento` quando o item está
 * `CONFIGURADO` no `product_operational_config`.
 */
export function catalogResolutionFromOperationalConfig(
  row: {
    configuration_status: string;
    final_operational_type: string | null;
    linked_entry_breakdown_recipe_id: string | null;
  } | null | undefined,
): CatalogResolutionHint | null {
  if (!row || row.configuration_status !== "CONFIGURADO" || !row.final_operational_type) {
    return null;
  }
  const t = row.final_operational_type as OperationalItemType;
  if (t === "REVISAO_PENDENTE") return null;

  if (t === "INSUMO" || t === "NAO_ESTOCAVEL") {
    return {
      summary:
        t === "INSUMO"
          ? "Classificação do cadastro: insumo (entrada direta)"
          : "Classificação do cadastro: item não estocável (entrada direta)",
      import_stock_resolution: "DIRECT",
      resolved_recipe_id: null,
      import_nature: "INSUMO",
      suggestion: "CATALOG_ONBOARDING_INSUMO",
    };
  }

  if (t === "PRODUTO_REVENDA" || t === "ITEM_OPERACIONAL") {
    return {
      summary: "Classificação do cadastro: entrada de estoque direta (revenda/operacional)",
      import_stock_resolution: "DIRECT",
      resolved_recipe_id: null,
      import_nature: "ESTOQUE_DIRETO",
      suggestion: "CATALOG_ONBOARDING_DIRETO",
    };
  }

  return null;
}

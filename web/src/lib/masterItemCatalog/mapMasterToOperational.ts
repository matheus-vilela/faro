import type { OperationalItemType } from "@/lib/itemClassification/operationalItemTypes";
import type { MasterCatalogConceptType } from "@/lib/masterItemCatalog/types";

/**
 * Mapeia o tipo conceitual da base mestre → enum persistido em `product_operational_config`.
 */
export function mapMasterConceptToOperational(c: MasterCatalogConceptType): OperationalItemType {
  switch (c) {
    case "INSUMO":
    case "RECEITA_CANDIDATE":
      return "INSUMO";
    case "BEBIDA_REVENDA":
    case "PRODUTO_REVENDA":
      return "PRODUTO_REVENDA";
    case "ITEM_OPERACIONAL":
    case "ATIVO_EQUIPAMENTO":
      return "ITEM_OPERACIONAL";
    case "NAO_ESTOCAVEL":
      return "NAO_ESTOCAVEL";
    case "RECEITA_FICHA":
      return "RECEITA_FICHA";
    default:
      return "REVISAO_PENDENTE";
  }
}

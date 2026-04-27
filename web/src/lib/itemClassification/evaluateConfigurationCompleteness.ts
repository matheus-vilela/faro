import type {
  ConfigurationStatus,
  OperationalItemType,
} from "@/lib/itemClassification/operationalItemTypes";

export type CompletenessFlags = {
  has_type: boolean;
  has_unit_when_required: boolean;
  has_category_when_required: boolean;
  has_recipe_when_required: boolean;
};

export type ProductFieldsForCompleteness = {
  unit?: string | null;
  cmv_category_id?: string | null;
  /** Pelo menos uma categoria de produto (`product_category_assignments`). */
  has_product_category_assignment?: boolean;
};

/**
 * Regras centrais de completude (espelhadas no backend ao persistir `CONFIGURADO`).
 * `REVISAO_PENDENTE` nunca fica "concluído" enquanto permanecer nesse tipo.
 */
export function evaluateConfigurationCompleteness(params: {
  finalType: OperationalItemType | null;
  product: ProductFieldsForCompleteness;
  linkedEntryBreakdownRecipeId: string | null;
}): { flags: CompletenessFlags; is_complete: boolean; configuration_status: ConfigurationStatus } {
  const { finalType, product, linkedEntryBreakdownRecipeId } = params;
  if (!finalType) {
    return {
      flags: {
        has_type: false,
        has_unit_when_required: false,
        has_category_when_required: false,
        has_recipe_when_required: false,
      },
      is_complete: false,
      configuration_status: "PENDENTE",
    };
  }

  if (finalType === "REVISAO_PENDENTE") {
    return {
      flags: {
        has_type: true,
        has_unit_when_required: false,
        has_category_when_required: false,
        has_recipe_when_required: false,
      },
      is_complete: false,
      configuration_status: "PARCIAL",
    };
  }

  const u = (product.unit ?? "").trim();
  const hasUnit = u.length > 0;
  const hasCat =
    (product.cmv_category_id != null && String(product.cmv_category_id).length > 0) ||
    product.has_product_category_assignment === true;

  let has_unit_when_required = hasUnit;
  let has_category_when_required = hasCat;
  let has_recipe_when_required = true;

  switch (finalType) {
    case "INSUMO":
    case "PRODUTO_REVENDA":
    case "ITEM_OPERACIONAL":
      has_unit_when_required = hasUnit;
      has_category_when_required = hasCat;
      break;
    case "RECEITA_FICHA":
      has_unit_when_required = hasUnit;
      has_category_when_required = hasCat;
      has_recipe_when_required = !!linkedEntryBreakdownRecipeId;
      if (!has_recipe_when_required) {
        return {
          flags: {
            has_type: true,
            has_unit_when_required,
            has_category_when_required,
            has_recipe_when_required: false,
          },
          is_complete: false,
          configuration_status: "BLOQUEADO",
        };
      }
      break;
    case "NAO_ESTOCAVEL":
      has_unit_when_required = true;
      has_category_when_required = hasCat;
      break;
    default:
      break;
  }

  const flags: CompletenessFlags = {
    has_type: true,
    has_unit_when_required,
    has_category_when_required,
    has_recipe_when_required,
  };

  const is_complete =
    flags.has_unit_when_required &&
    flags.has_category_when_required &&
    flags.has_recipe_when_required;

  return {
    flags,
    is_complete,
    configuration_status: is_complete ? "CONFIGURADO" : "PARCIAL",
  };
}

/**
 * Camada de conversão: unidade da nota → quantidade na unidade padrão do produto (estoque).
 *
 * Regras:
 * - Conversão global (massa/volume) só é automática se `autoApplyGlobalMassVolume` for true.
 * - Regra por produto (`product_unit_rules`) pode ser `auto_apply` e/ou `requires_confirmation`.
 * - Unidades ambíguas (ex.: SACHE → KG) exigem regra explícita ou confirmação.
 */

import {
  conversionFactorToA,
  normalizeUnitLabel,
  unitsAreEqual,
  unitsAreConvertible,
  type NormalizedUnitCode,
} from "./unitNormalize.ts";

/** Origem rastreável da decisão de conversão (alinhado ao prompt de negócio). */
export type ResolutionSource =
  | "DIRECT_UNIT_MATCH"
  | "AUTO_CONVERTED_GLOBAL_RULE"
  | "AUTO_CONVERTED_PRODUCT_RULE"
  | "UNIT_VALIDATION_REQUIRED"
  | "UNKNOWN_INVOICE_UNIT"

export type ProductUnitRuleRow = {
  from_unit_normalized: string
  to_unit_normalized: string
  conversion_factor: number
  auto_apply: boolean
  requires_confirmation: boolean
}

export type ComputeStockResult = {
  /** Quantidade na unidade do cadastro (estoque). */
  stockQuantity: number
  /** Fator aplicado: stockQuantity = invoiceQuantity × conversionFactorApplied */
  conversionFactorApplied: number
  resolutionSource: ResolutionSource
  /** Se true, o fluxo deve abrir conferência antes de persistir com esta conversão. */
  needsUserConfirmation: boolean
}

function roundQty(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

/**
 * Calcula quantidade de estoque e fator a partir da linha da nota e do produto.
 */
export function computeStockQuantity(params: {
  invoiceQuantity: number
  invoiceUnit: NormalizedUnitCode
  productUnitRaw: string | null | undefined
  autoApplyGlobalMassVolume: boolean
  productRule: ProductUnitRuleRow | null | undefined
}): ComputeStockResult {
  const catalogU = normalizeUnitLabel(params.productUnitRaw)
  const q = Math.max(0.0001, params.invoiceQuantity)
  const inv = params.invoiceUnit

  if (inv === "UNKN") {
    return {
      stockQuantity: roundQty(q),
      conversionFactorApplied: 1,
      resolutionSource: "UNKNOWN_INVOICE_UNIT",
      needsUserConfirmation: true,
    }
  }

  if (unitsAreEqual(inv, catalogU)) {
    return {
      stockQuantity: roundQty(q),
      conversionFactorApplied: 1,
      resolutionSource: "DIRECT_UNIT_MATCH",
      needsUserConfirmation: false,
    }
  }

  const rule = params.productRule
  if (
    rule &&
    rule.from_unit_normalized === inv &&
    rule.to_unit_normalized === catalogU
  ) {
    const f = Number(rule.conversion_factor)
    if (!Number.isFinite(f) || f <= 0) {
      return {
        stockQuantity: roundQty(q),
        conversionFactorApplied: 1,
        resolutionSource: "UNIT_VALIDATION_REQUIRED",
        needsUserConfirmation: true,
      }
    }
    const stock = roundQty(q * f)
    const auto = rule.auto_apply && !rule.requires_confirmation
    return {
      stockQuantity: stock,
      conversionFactorApplied: f,
      resolutionSource: "AUTO_CONVERTED_PRODUCT_RULE",
      needsUserConfirmation: !auto,
    }
  }

  if (unitsAreConvertible(inv, catalogU)) {
    const f = conversionFactorToA(catalogU, inv)
    if (f == null) {
      return {
        stockQuantity: roundQty(q),
        conversionFactorApplied: 1,
        resolutionSource: "UNIT_VALIDATION_REQUIRED",
        needsUserConfirmation: true,
      }
    }
    const stock = roundQty(q * f)
    if (params.autoApplyGlobalMassVolume) {
      return {
        stockQuantity: stock,
        conversionFactorApplied: f,
        resolutionSource: "AUTO_CONVERTED_GLOBAL_RULE",
        needsUserConfirmation: false,
      }
    }
    return {
      stockQuantity: stock,
      conversionFactorApplied: f,
      resolutionSource: "AUTO_CONVERTED_GLOBAL_RULE",
      needsUserConfirmation: true,
    }
  }

  return {
    stockQuantity: roundQty(q),
    conversionFactorApplied: 1,
    resolutionSource: "UNIT_VALIDATION_REQUIRED",
    needsUserConfirmation: true,
  }
}

/** Encontra regra aplicável invoice → catálogo para o produto. */
export function pickProductUnitRule(
  rules: ProductUnitRuleRow[],
  invoiceU: NormalizedUnitCode,
  catalogU: NormalizedUnitCode,
): ProductUnitRuleRow | null {
  return (
    rules.find(
      (r) =>
        r.from_unit_normalized === invoiceU && r.to_unit_normalized === catalogU,
    ) ?? null
  )
}

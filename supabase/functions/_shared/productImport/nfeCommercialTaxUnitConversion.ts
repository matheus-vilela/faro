/**
 * NF-e: quando uCom ≠ uTrib, deriva conversão entre as duas unidades.
 * Se uTrib for UN (unidade), estoque e cálculos usam UN; conversão N un → 1 uCom.
 */
import type { ProductUnitConversionInsert } from "./buildPackUnitConversionsFromLabel.ts";
import { mapInvoiceUnitToCatalogUnit } from "./invoiceUnitToCatalogUnit.ts";
import { normalizeUnitLabel } from "./unitNormalize.ts";

export type NfeCommercialTaxUnitInput = {
  unitCommercial?: string | null;
  unitTax?: string | null;
  quantityCommercial?: number | null;
  quantityTax?: number | null;
  /** Fallback quando só há uma quantidade parseada (em geral qCom). */
  quantity?: number | null;
};

function roundQty(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function positiveQty(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || !(v > 0)) return null;
  return v;
}

/** Unidades comercial e tributável distintas após normalização. */
export function nfeCommercialAndTaxUnitsDiffer(
  unitCommercial: string,
  unitTax: string,
): boolean {
  const a = normalizeUnitLabel(unitCommercial);
  const b = normalizeUnitLabel(unitTax);
  if (a !== "UNKN" && b !== "UNKN") return a !== b;
  const ra = unitCommercial.trim().toLowerCase();
  const rb = unitTax.trim().toLowerCase();
  return ra.length > 0 && rb.length > 0 && ra !== rb;
}

/** uTrib é UN/UND e uCom é outra → estoque, preço e conversão na base UN. */
export function nfeUsesUnTaxUnitBase(
  unitCommercial: string | null | undefined,
  unitTax: string | null | undefined,
): boolean {
  const uCom = String(unitCommercial ?? "").trim();
  const uTrib = String(unitTax ?? "").trim();
  if (!uCom || !uTrib) return false;
  if (!nfeCommercialAndTaxUnitsDiffer(uCom, uTrib)) return false;
  return normalizeUnitLabel(uTrib) === "UND";
}

export type CommercialTaxUnitConversionResult = {
  stockUnit: string;
  conversions: ProductUnitConversionInsert[];
  note: string;
};

/**
 * Constrói conversão entre uCom e uTrib quando a NF-e informa ambas as quantidades.
 * Com uTrib UN: estoque em UN e `{factor} un = 1 {uCom}`.
 * Caso contrário: estoque em uCom e `1 {uCom} = {factor} {uTrib}`.
 */
export function buildCommercialTaxUnitConversion(
  input: NfeCommercialTaxUnitInput,
): CommercialTaxUnitConversionResult | null {
  const uCom = String(input.unitCommercial ?? "").trim();
  const uTrib = String(input.unitTax ?? "").trim();
  if (!uCom || !uTrib) return null;
  if (!nfeCommercialAndTaxUnitsDiffer(uCom, uTrib)) return null;

  const qCom =
    positiveQty(input.quantityCommercial) ?? positiveQty(input.quantity);
  const qTrib = positiveQty(input.quantityTax);
  if (qCom == null || qTrib == null) return null;

  const factor = roundQty(qTrib / qCom);
  if (!(factor > 0) || !Number.isFinite(factor)) return null;

  const mappedCom = mapInvoiceUnitToCatalogUnit(uCom);
  const mappedTrib = mapInvoiceUnitToCatalogUnit(uTrib);
  const comUnit = mappedCom.unit.slice(0, 32) || "un";
  const tribUnit = mappedTrib.unit.slice(0, 32) || "un";
  if (comUnit === tribUnit) return null;

  if (nfeUsesUnTaxUnitBase(uCom, uTrib)) {
    return {
      stockUnit: tribUnit,
      conversions: [
        {
          primary_qty: factor,
          primary_unit_code: tribUnit,
          secondary_qty: 1,
          secondary_unit_code: comUnit,
        },
      ],
      note: `NF-e: ${factor} ${tribUnit} = 1 ${comUnit} (base UN)`,
    };
  }

  return {
    stockUnit: comUnit,
    conversions: [
      {
        primary_qty: 1,
        primary_unit_code: comUnit,
        secondary_qty: factor,
        secondary_unit_code: tribUnit,
      },
    ],
    note: `NF-e: 1 ${comUnit} = ${factor} ${tribUnit} (qCom/qTrib)`,
  };
}

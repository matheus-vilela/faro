/**
 * NF-e: quando uCom ≠ uTrib, deriva conversão 1 uCom = (qTrib/qCom) uTrib.
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

export type CommercialTaxUnitConversionResult = {
  stockUnit: string;
  conversions: ProductUnitConversionInsert[];
  note: string;
};

/**
 * Constrói 1 {uCom} = (qTrib/qCom) {uTrib} quando a NF-e informa ambas as unidades.
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
  const stockUnit = mappedCom.unit.slice(0, 32) || "un";
  const secondary = mappedTrib.unit.slice(0, 32) || "un";
  if (stockUnit === secondary) return null;

  return {
    stockUnit,
    conversions: [
      {
        primary_qty: 1,
        primary_unit_code: stockUnit,
        secondary_qty: factor,
        secondary_unit_code: secondary,
      },
    ],
    note: `NF-e: 1 ${stockUnit} = ${factor} ${secondary} (qCom/qTrib)`,
  };
}

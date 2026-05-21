/**
 * Aplica preço unitário efetivo, quantidade e total de linha logo após o parse do XML,
 * sobrescrevendo valores brutos (vUnCom/vProd) para que fluxos downstream não usem preços errados.
 */
import type { ExtractedDocumentResult, ExtractedExpenseItem } from "./openaiExpense.ts";
import {
  computeEffectiveUnitPricesForCatalogLines,
  type EffectiveUnitPriceLine,
} from "./nfeEffectiveUnitPrice.ts";
import { nfeUsesUnTaxUnitBase } from "./productImport/nfeCommercialTaxUnitConversion.ts";
import {
  extractNfeTaxTotalsFromXml,
  type NfeXmlDetLineForCatalog,
} from "./parseNfeXml.ts";

function roundMoney(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

/** vNF − soma dos totais efetivos das linhas CFOP 5910 (bonificação). */
export function resolveNfeValorRealNota(
  xmlText: string,
  prices: EffectiveUnitPriceLine[],
): number | null {
  const totals = extractNfeTaxTotalsFromXml(xmlText);
  const vNf = totals?.vNF;
  if (!(vNf != null && vNf > 0)) return null;

  let sumBonif = 0;
  for (const p of prices) {
    if (p.is_bonification && p.breakdown?.effective_line_total) {
      sumBonif += p.breakdown.effective_line_total;
    }
  }
  if (sumBonif > 0.000001) return roundMoney(vNf - sumBonif);
  return roundMoney(vNf);
}

function applyEffectiveLineToItem(
  item: ExtractedExpenseItem,
  line: NfeXmlDetLineForCatalog,
  price: EffectiveUnitPriceLine | undefined,
): void {
  const prod = line.prod;
  const uCom = str(prod.uCom);
  const uTrib = str(prod.uTrib);
  const useUn = nfeUsesUnTaxUnitBase(uCom, uTrib);

  const b = price?.breakdown;
  const effUnit = price?.effectiveUnitPrice;
  if (!b || effUnit == null || !(effUnit > 0)) return;

  item.quantity = b.quantity;
  item.unitValue = roundMoney(effUnit);
  item.lineTotal = roundMoney(b.effective_line_total);
  item.unitValueCommercial = null;
  item.unitValueTax = null;

  if (useUn) {
    item.quantityTax = b.quantity;
  } else {
    item.quantityCommercial = b.quantity;
  }
}

/**
 * Calcula preços efetivos por linha `det` e total real da nota (vNF − bonificação 5910).
 */
export function computeNfeEffectivePricingForXml(
  xmlText: string,
  detLines: NfeXmlDetLineForCatalog[],
): {
  prices: EffectiveUnitPriceLine[];
  documentTotal: number | null;
} | null {
  if (!detLines.length) return null;
  const prices = computeEffectiveUnitPricesForCatalogLines(detLines, xmlText);
  const documentTotal = resolveNfeValorRealNota(xmlText, prices);
  return { prices, documentTotal };
}

/**
 * Sobrescreve `items` e `totalAmount` do documento extraído com valores efetivos.
 */
export function applyNfeEffectivePricingToExtracted(
  extracted: ExtractedDocumentResult,
  xmlText: string,
  detLines: NfeXmlDetLineForCatalog[],
): void {
  const items = extracted.items ?? [];
  if (!items.length) return;

  const lines = detLines;
  if (!lines.length || lines.length !== items.length) return;

  const pricing = computeNfeEffectivePricingForXml(xmlText, lines);
  if (!pricing) return;

  for (let i = 0; i < items.length; i++) {
    applyEffectiveLineToItem(items[i]!, lines[i]!, pricing.prices[i]);
  }

  if (pricing.documentTotal != null && pricing.documentTotal > 0) {
    extracted.totalAmount = pricing.documentTotal;
  }
}

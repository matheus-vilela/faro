/**
 * Preço unitário efetivo pago por linha NF-e (uCom): líquido da linha + rateio de frete/desconto/outros do ICMSTot.
 */
import { extractIcmsTotalsFromNfeXml } from "./nfeExpenseProducts/financialReconciliation.ts";
import type { NfeXmlDetLineForCatalog } from "./parseNfeXml.ts";

function num(v: unknown): number {
  if (v === undefined || v === null) return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export type EffectiveUnitPriceBreakdown = {
  v_prod: number;
  line_discount: number;
  line_freight: number;
  line_other: number;
  line_insurance: number;
  line_net_before_global: number;
  global_allocation: number;
  effective_line_total: number;
  quantity: number;
};

export type EffectiveUnitPriceLine = {
  lineIndex: number;
  effectiveUnitPrice: number | null;
  breakdown: EffectiveUnitPriceBreakdown | null;
};

function lineQuantityForPricing(prod: Record<string, unknown>): number {
  const qCom = num(prod.qCom);
  if (qCom > 0) return qCom;
  const qTrib = num(prod.qTrib);
  return Math.max(0.0001, qTrib);
}

function lineGrossWeight(prod: Record<string, unknown>): number {
  const vProd = num(prod.vProd);
  if (vProd > 0) return vProd;
  const q = lineQuantityForPricing(prod);
  const vUnCom = num(prod.vUnCom);
  const vu = vUnCom > 0 ? vUnCom : num(prod.vUnTrib);
  if (q > 0 && vu > 0) return q * vu;
  return 0;
}

function lineNetBeforeGlobal(prod: Record<string, unknown>): {
  net: number;
  q: number;
  parts: Omit<
    EffectiveUnitPriceBreakdown,
    "global_allocation" | "effective_line_total"
  >;
} | null {
  const q = lineQuantityForPricing(prod);
  const vProd = num(prod.vProd);
  const vUnCom = num(prod.vUnCom);
  const gross = vProd > 0
    ? vProd
    : q * (vUnCom > 0 ? vUnCom : num(prod.vUnTrib));
  if (!(gross > 0) || !(q > 0)) return null;

  const lineDiscount = Math.max(0, num(prod.vDesc));
  const lineFreight = Math.max(0, num(prod.vFrete));
  const lineOther = Math.max(0, num(prod.vOutro));
  const lineInsurance = Math.max(0, num(prod.vSeg));

  const net = gross - lineDiscount + lineFreight + lineOther + lineInsurance;

  return {
    net: roundMoney(net),
    q,
    parts: {
      v_prod: roundMoney(gross),
      line_discount: roundMoney(lineDiscount),
      line_freight: roundMoney(lineFreight),
      line_other: roundMoney(lineOther),
      line_insurance: roundMoney(lineInsurance),
      line_net_before_global: roundMoney(net),
      quantity: q,
    },
  };
}

/**
 * Unitário efetivo só com ajustes da linha (vDesc, vFrete, vOutro, vSeg), sem rateio ICMSTot.
 */
export function effectiveUnitPriceWithoutGlobalAllocation(
  prod: Record<string, unknown>,
): number | null {
  const parsed = lineNetBeforeGlobal(prod);
  if (!parsed || !(parsed.net > 0)) return null;
  const u = roundMoney(parsed.net / parsed.q);
  return u > 0 ? u : null;
}

/**
 * Para cada linha do catálogo, calcula o unitário efetivo (total líquido rateado / qCom).
 */
export function computeEffectiveUnitPricesForCatalogLines(
  lines: NfeXmlDetLineForCatalog[],
  xmlText: string,
): EffectiveUnitPriceLine[] {
  const icms = extractIcmsTotalsFromNfeXml(xmlText);
  const globalDelta = roundMoney(
    (icms?.vFrete ?? 0) -
      (icms?.vDesc ?? 0) +
      (icms?.vOutro ?? 0) +
      (icms?.vSeg ?? 0),
  );

  const weights: number[] = lines.map((l) => lineGrossWeight(l.prod));
  const sumWeights = weights.reduce((a, b) => a + b, 0);

  return lines.map((line, lineIndex) => {
    const parsed = lineNetBeforeGlobal(line.prod);
    if (!parsed || !(parsed.net > 0)) {
      return { lineIndex, effectiveUnitPrice: null, breakdown: null };
    }

    let globalAllocation = 0;
    if (sumWeights > 0 && globalDelta !== 0) {
      globalAllocation = roundMoney(
        (weights[lineIndex]! / sumWeights) * globalDelta,
      );
    }

    const effectiveLineTotal = roundMoney(parsed.net + globalAllocation);
    const effectiveUnitPrice =
      effectiveLineTotal > 0
        ? roundMoney(effectiveLineTotal / parsed.q)
        : null;

    return {
      lineIndex,
      effectiveUnitPrice: effectiveUnitPrice != null && effectiveUnitPrice > 0
        ? effectiveUnitPrice
        : null,
      breakdown: {
        ...parsed.parts,
        global_allocation: globalAllocation,
        effective_line_total: effectiveLineTotal,
      },
    };
  });
}

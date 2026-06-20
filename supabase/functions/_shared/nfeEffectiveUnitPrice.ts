/**
 * Preço unitário efetivo por linha NF-e (uCom):
 * ((qtd × valor unitário) − desconto + IPI + ICMS ST + FCP ST + juros) / qtd
 * Impostos na linha (`det/imposto`); excedentes de ICMSTot rateados por vProd bruto; vOutro e juros
 * da cobrança rateados pela base líquida (vProd − vDesc) dos itens cobrados.
 */
import { extractDuplicatesFromNfeXml } from "./extractDupFromNfeXml.ts";
import { isNfeBonificationCfop } from "./nfeCfopBonification.ts";
import { nfeUsesUnTaxUnitBase } from "./productImport/nfeCommercialTaxUnitConversion.ts";
import type { NfeXmlDetLineForCatalog } from "./parseNfeXml.ts";
import { extractNfeTaxTotalsFromXml } from "./parseNfeXml.ts";

function num(v: unknown): number {
  if (v === undefined || v === null) return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

const LINE_TAX_KEYS = new Set(["vIPI", "vICMSST", "vFCPST"]);

export type EffectiveUnitPriceBreakdown = {
  quantity: number;
  unit_value: number;
  gross: number;
  line_discount: number;
  line_ipi: number;
  line_icms_st: number;
  line_fcp_st: number;
  line_juros: number;
  line_net_before_global: number;
  global_ipi_allocation: number;
  global_icms_st_allocation: number;
  global_fcp_st_allocation: number;
  global_juros_allocation: number;
  /** Rateio do ICMSTot vOutro (outras despesas), proporcional a vProd − vDesc; CFOP 5910 excluído. */
  global_voutro_allocation: number;
  effective_line_total: number;
};

export type EffectiveUnitPriceLine = {
  lineIndex: number;
  effectiveUnitPrice: number | null;
  breakdown: EffectiveUnitPriceBreakdown | null;
  /** CFOP 5910 — bonificação; excluída do rateio global e do valor cobrado da nota. */
  is_bonification: boolean;
};

function lineCfopFromCatalogLine(line: NfeXmlDetLineForCatalog): string | null {
  const fromDet = line.cfop;
  if (fromDet) return fromDet;
  const prod = line.prod;
  const raw = prod.CFOP ?? prod.cfop;
  return raw != null ? String(raw).trim() : null;
}

function lineUsesUnTaxBase(prod: Record<string, unknown>): boolean {
  const uCom = String(prod.uCom ?? "").trim();
  const uTrib = String(prod.uTrib ?? "").trim();
  return nfeUsesUnTaxUnitBase(uCom, uTrib);
}

function lineQuantityForPricing(prod: Record<string, unknown>): number {
  const qTrib = num(prod.qTrib);
  const qCom = num(prod.qCom);
  if (lineUsesUnTaxBase(prod) && qTrib > 0) return qTrib;
  if (qCom > 0) return qCom;
  return Math.max(0.0001, qTrib);
}

function lineGrossWeight(prod: Record<string, unknown>): number {
  const parsed = lineGrossAndUnit(prod);
  return parsed?.gross ?? 0;
}

/**
 * Base líquida do item antes de impostos/adicional (regra NF para ratear vOutro):
 * `vProd − vDesc` (itens cobrados; bonificação 5910 fica com peso 0 no chamador).
 */
export function lineLiquidBaseForVOutroAllocation(
  prod: Record<string, unknown>,
): number {
  const vProd = num(prod.vProd);
  const vDesc = Math.max(0, num(prod.vDesc));
  if (vProd > 0) {
    return roundMoney(Math.max(0, vProd - vDesc));
  }
  const parsed = lineGrossAndUnit(prod);
  if (!parsed) return 0;
  return roundMoney(Math.max(0, parsed.gross - vDesc));
}

/** `prod/vOutro` informado pelo emitente na linha (ex.: adicional financeiro Heineken). */
export function lineVOutroFromProd(prod: Record<string, unknown>): number {
  const v = num(prod.vOutro);
  return v > 0 ? roundMoney(v) : 0;
}

const VOUTRO_TOTAL_TOLERANCE = 0.02;

/**
 * vOutro por linha: usa `prod/vOutro` quando todos os itens cobrados trazem o campo e a soma
 * bate com ICMSTot; senão rateia o excedente pela base líquida (vProd − vDesc).
 */
function resolveVOutroAllocationPerLine(
  lines: NfeXmlDetLineForCatalog[],
  isBonification: boolean[],
  globalVOutro: number,
  liquidWeights: number[],
): number[] {
  if (!(globalVOutro > 0)) return lines.map(() => 0);

  const explicit = lines.map((l, i) =>
    isBonification[i] ? 0 : lineVOutroFromProd(l.prod)
  );
  const sumExplicit = roundMoney(explicit.reduce((a, b) => a + b, 0));
  const chargedIndices = lines
    .map((_, i) => i)
    .filter((i) => !isBonification[i]);
  const explicitOnAllCharged = chargedIndices.length > 0 &&
    chargedIndices.every((i) => explicit[i]! > 0);

  if (
    sumExplicit > 0 &&
    explicitOnAllCharged &&
    Math.abs(sumExplicit - globalVOutro) <= VOUTRO_TOTAL_TOLERANCE
  ) {
    return explicit;
  }

  if (sumExplicit > 0) {
    const remainder = roundMoney(Math.max(0, globalVOutro - sumExplicit));
    const needAlloc = lines.map((_, i) =>
      !isBonification[i] && explicit[i] === 0
    );
    if (remainder > 0 && needAlloc.some(Boolean)) {
      const allocWeights = liquidWeights.map((w, i) =>
        needAlloc[i] ? w : 0
      );
      const partial = allocateProportionalExact(allocWeights, remainder);
      return explicit.map((e, i) => roundMoney(e + (partial[i] ?? 0)));
    }
    if (Math.abs(sumExplicit - globalVOutro) <= VOUTRO_TOTAL_TOLERANCE) {
      return explicit;
    }
  }

  const sumLiquid = liquidWeights.reduce((a, b) => a + b, 0);
  if (sumLiquid > 0) {
    return allocateProportionalExact(liquidWeights, globalVOutro);
  }
  return lines.map(() => 0);
}

function lineGrossAndUnit(
  prod: Record<string, unknown>,
): { gross: number; q: number; unitValue: number } | null {
  const useUn = lineUsesUnTaxBase(prod);
  const q = lineQuantityForPricing(prod);
  const vUnCom = num(prod.vUnCom);
  const vUnTrib = num(prod.vUnTrib);
  const unitValue = useUn
    ? (vUnTrib > 0 ? vUnTrib : vUnCom > 0 ? vUnCom : 0)
    : (vUnCom > 0 ? vUnCom : vUnTrib > 0 ? vUnTrib : 0);
  if (q > 0 && unitValue > 0) {
    return { gross: roundMoney(q * unitValue), q, unitValue };
  }
  const vProd = num(prod.vProd);
  if (vProd > 0 && q > 0) {
    return { gross: roundMoney(vProd), q, unitValue: roundMoney(vProd / q) };
  }
  return null;
}

/**
 * Soma IPI, ICMS ST e FCP ST do bloco `det/imposto` da linha (valores do produto no XML).
 * ICMS ST: usa vICMSST; se zero, tenta vST no mesmo bloco (não confundir com ICMSTot).
 */
export function sumLineImpostoTaxFields(
  imposto: Record<string, unknown> | undefined,
): { vIPI: number; vICMSST: number; vFCPST: number } {
  const acc = { vIPI: 0, vICMSST: 0, vFCPST: 0 };
  if (!imposto) return acc;

  let icmsStVstFallback = 0;

  function walk(node: unknown, insideIcms: boolean): void {
    if (node == null) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, insideIcms);
      return;
    }
    if (typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    const inIcms =
      insideIcms ||
      "ICMS" in o ||
      "icms" in o ||
      Object.keys(o).some((k) => /^ICMS\d{2,3}$/i.test(k));

    for (const [k, v] of Object.entries(o)) {
      if (k === "vIPI" || k === "vFCPST") {
        const n = Math.max(0, num(v));
        if (k === "vIPI") acc.vIPI += n;
        else acc.vFCPST += n;
      } else if (k === "vICMSST") {
        acc.vICMSST += Math.max(0, num(v));
      } else if (k === "vST" && inIcms) {
        icmsStVstFallback += Math.max(0, num(v));
      } else if (v != null && typeof v === "object") {
        walk(v, inIcms);
      }
    }
  }

  walk(imposto, false);
  if (!(acc.vICMSST > 0) && icmsStVstFallback > 0) {
    acc.vICMSST = icmsStVstFallback;
  }

  return {
    vIPI: roundMoney(acc.vIPI),
    vICMSST: roundMoney(acc.vICMSST),
    vFCPST: roundMoney(acc.vFCPST),
  };
}

/** Juros/acréscimos da nota: parcelas (`dup`) acima do `vNF`, quando existir cobrança. */
export function extractNfeJurosFromXml(xmlText: string): number {
  const totals = extractNfeTaxTotalsFromXml(xmlText);
  const vNF = totals?.vNF != null && totals.vNF > 0 ? totals.vNF : 0;
  if (!(vNF > 0)) return 0;

  const dups = extractDuplicatesFromNfeXml(xmlText);
  if (dups.length === 0) return 0;

  const sumDup = roundMoney(dups.reduce((s, d) => s + d.amount, 0));
  const delta = roundMoney(sumDup - vNF);
  return delta > 0.000001 ? delta : 0;
}

function impostoFromLine(line: NfeXmlDetLineForCatalog): Record<string, unknown> | undefined {
  const fromDet = line.xmlDet.imposto;
  if (fromDet != null && typeof fromDet === "object" && !Array.isArray(fromDet)) {
    return fromDet as Record<string, unknown>;
  }
  return undefined;
}

function lineNetBeforeGlobal(
  prod: Record<string, unknown>,
  imposto: Record<string, unknown> | undefined,
  lineJuros = 0,
): {
  net: number;
  q: number;
  unitValue: number;
  parts: Omit<
    EffectiveUnitPriceBreakdown,
    | "global_ipi_allocation"
    | "global_icms_st_allocation"
    | "global_fcp_st_allocation"
    | "global_juros_allocation"
    | "effective_line_total"
  >;
} | null {
  const base = lineGrossAndUnit(prod);
  if (!base || !(base.gross > 0) || !(base.q > 0)) return null;

  const lineDiscount = Math.max(0, num(prod.vDesc));
  const taxes = sumLineImpostoTaxFields(imposto);
  const juros = roundMoney(Math.max(0, lineJuros));

  const net = roundMoney(
    base.gross -
      lineDiscount +
      taxes.vIPI +
      taxes.vICMSST +
      taxes.vFCPST +
      juros,
  );

  return {
    net,
    q: base.q,
    unitValue: base.unitValue,
    parts: {
      quantity: base.q,
      unit_value: base.unitValue,
      gross: base.gross,
      line_discount: roundMoney(lineDiscount),
      line_ipi: taxes.vIPI,
      line_icms_st: taxes.vICMSST,
      line_fcp_st: taxes.vFCPST,
      line_juros: juros,
      line_net_before_global: net,
    },
  };
}

/**
 * Unitário efetivo só com campos da linha (sem rateio de totais ICMSTot / juros da cobrança).
 */
export function effectiveUnitPriceWithoutGlobalAllocation(
  prod: Record<string, unknown>,
  imposto?: Record<string, unknown>,
): number | null {
  const parsed = lineNetBeforeGlobal(prod, imposto, 0);
  if (!parsed || !(parsed.net > 0)) return null;
  const u = roundMoney(parsed.net / parsed.q);
  return u > 0 ? u : null;
}

function allocateGlobalRemainder(
  lineRemainders: number[],
  globalRemainder: number,
): number[] {
  const n = lineRemainders.length;
  if (n === 0 || globalRemainder === 0) return lineRemainders.map(() => 0);
  const sumRemainders = lineRemainders.reduce((a, b) => a + b, 0);
  if (sumRemainders <= 0) return lineRemainders.map(() => 0);
  return lineRemainders.map((w) =>
    roundMoney((w / sumRemainders) * globalRemainder)
  );
}

/**
 * Rateia `total` pelo peso de cada linha (ex.: vProd); a soma das parcelas = `total` (centavos).
 */
export function allocateProportionalExact(
  weights: number[],
  total: number,
): number[] {
  const n = weights.length;
  if (n === 0 || !(total > 0)) return weights.map(() => 0);
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (!(sumW > 0)) return weights.map(() => 0);

  const rounded = weights.map((w) => roundMoney((w / sumW) * total));
  let diff = roundMoney(total - rounded.reduce((a, b) => a + b, 0));
  if (diff !== 0) {
    let maxI = 0;
    for (let i = 1; i < n; i++) {
      if (weights[i]! > weights[maxI]!) maxI = i;
    }
    rounded[maxI] = roundMoney(rounded[maxI]! + diff);
  }
  return rounded;
}

/** Rateia excedente do ICMSTot só em linhas que não trazem o imposto no `det/imposto`. */
function allocateGlobalRemainderExcludingLinesWithTax(
  weights: number[],
  globalRemainder: number,
  lineAlreadyHasTax: boolean[],
): number[] {
  if (globalRemainder <= 0) return weights.map(() => 0);
  const eligible = weights.map((w, i) =>
    lineAlreadyHasTax[i] ? 0 : w
  );
  const sumEligible = eligible.reduce((a, b) => a + b, 0);
  if (sumEligible <= 0) {
    return allocateGlobalRemainder(weights, globalRemainder);
  }
  return allocateGlobalRemainder(eligible, globalRemainder);
}

/**
 * Para cada linha do catálogo, calcula o unitário efetivo conforme a fórmula de custo da linha.
 */
export function computeEffectiveUnitPricesForCatalogLines(
  lines: NfeXmlDetLineForCatalog[],
  xmlText: string,
): EffectiveUnitPriceLine[] {
  const totals = extractNfeTaxTotalsFromXml(xmlText);
  const globalIpi = totals?.vIPI != null && totals.vIPI > 0 ? totals.vIPI : 0;
  const globalSt = totals?.vST != null && totals.vST > 0 ? totals.vST : 0;
  const globalFcpSt = totals?.vFCPST != null && totals.vFCPST > 0
    ? totals.vFCPST
    : 0;
  const globalJuros = extractNfeJurosFromXml(xmlText);
  const globalVOutro = totals?.vOutro != null && totals.vOutro > 0
    ? totals.vOutro
    : 0;

  const isBonification = lines.map((line) =>
    isNfeBonificationCfop(lineCfopFromCatalogLine(line))
  );
  const weights = lines.map((l, i) =>
    isBonification[i] ? 0 : lineGrossWeight(l.prod)
  );
  const liquidWeights = lines.map((l, i) =>
    isBonification[i] ? 0 : lineLiquidBaseForVOutroAllocation(l.prod)
  );
  const sumWeights = weights.reduce((a, b) => a + b, 0);
  const sumLiquidWeights = liquidWeights.reduce((a, b) => a + b, 0);

  const parsedLines = lines.map((line) =>
    lineNetBeforeGlobal(line.prod, impostoFromLine(line), 0)
  );

  const sumLineIpi = parsedLines.reduce(
    (s, p, i) => s + (isBonification[i] ? 0 : (p?.parts.line_ipi ?? 0)),
    0,
  );
  const sumLineSt = parsedLines.reduce(
    (s, p, i) => s + (isBonification[i] ? 0 : (p?.parts.line_icms_st ?? 0)),
    0,
  );
  const sumLineFcpSt = parsedLines.reduce(
    (s, p, i) => s + (isBonification[i] ? 0 : (p?.parts.line_fcp_st ?? 0)),
    0,
  );

  const lineHasIpi = parsedLines.map((p, i) =>
    isBonification[i] || (p?.parts.line_ipi ?? 0) > 0
  );
  const lineHasSt = parsedLines.map((p, i) =>
    isBonification[i] || (p?.parts.line_icms_st ?? 0) > 0
  );
  const lineHasFcpSt = parsedLines.map((p, i) =>
    isBonification[i] || (p?.parts.line_fcp_st ?? 0) > 0
  );

  const ipiAlloc = allocateGlobalRemainderExcludingLinesWithTax(
    weights,
    roundMoney(Math.max(0, globalIpi - sumLineIpi)),
    lineHasIpi,
  );
  const stAlloc = allocateGlobalRemainderExcludingLinesWithTax(
    weights,
    roundMoney(Math.max(0, globalSt - sumLineSt)),
    lineHasSt,
  );
  const fcpStAlloc = allocateGlobalRemainderExcludingLinesWithTax(
    weights,
    roundMoney(Math.max(0, globalFcpSt - sumLineFcpSt)),
    lineHasFcpSt,
  );
  const jurosAlloc = sumWeights > 0 && globalJuros > 0
    ? allocateProportionalExact(weights, globalJuros)
    : weights.map(() => 0);
  const vOutroAlloc = resolveVOutroAllocationPerLine(
    lines,
    isBonification,
    globalVOutro,
    liquidWeights,
  );

  return lines.map((line, lineIndex) => {
    const bonif = isBonification[lineIndex] ?? false;
    const parsed = parsedLines[lineIndex];
    if (!parsed || !(parsed.net > 0)) {
      return {
        lineIndex,
        effectiveUnitPrice: null,
        breakdown: null,
        is_bonification: bonif,
      };
    }

    const globalIpiA = bonif ? 0 : (ipiAlloc[lineIndex] ?? 0);
    const globalStA = bonif ? 0 : (stAlloc[lineIndex] ?? 0);
    const globalFcpStA = bonif ? 0 : (fcpStAlloc[lineIndex] ?? 0);
    const globalJurosA = bonif ? 0 : (jurosAlloc[lineIndex] ?? 0);
    const globalVOutroA = bonif ? 0 : (vOutroAlloc[lineIndex] ?? 0);

    const effectiveLineTotal = roundMoney(
      parsed.net +
        globalIpiA +
        globalStA +
        globalFcpStA +
        globalJurosA +
        globalVOutroA,
    );
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
        global_ipi_allocation: globalIpiA,
        global_icms_st_allocation: globalStA,
        global_fcp_st_allocation: globalFcpStA,
        global_juros_allocation: globalJurosA,
        global_voutro_allocation: globalVOutroA,
        effective_line_total: effectiveLineTotal,
      },
      is_bonification: bonif,
    };
  });
}

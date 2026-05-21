/**
 * Breakdown legível do preço unitário efetivo por linha NF-e (laboratório / conferência).
 */
import {
  extractNfeJurosFromXml,
  type EffectiveUnitPriceBreakdown,
} from "./nfeEffectiveUnitPrice.ts";
import { computeNfeEffectivePricingForXml } from "./nfeXmlEffectivePricing.ts";
import { extractNfeTaxTotalsFromXml } from "./parseNfeXml.ts";
import { isNfeBonificationCfop, normalizeCfop4 } from "./nfeCfopBonification.ts";
import { nfeUsesUnTaxUnitBase } from "./productImport/nfeCommercialTaxUnitConversion.ts";
import { parseNfeXmlForUnifiedCatalog } from "./parseNfeXml.ts";

export type NfeUnitPricePreviewStep = {
  label: string;
  amount: number;
  effect: "add" | "subtract" | "base" | "subtotal" | "result";
  detail: string | null;
};

/** Colunas da tabela de conferência (valores monetários ≥ 0; desconto é positivo no XML). */
export type NfeUnitPricePreviewRow = {
  quantity: number;
  gross: number;
  discount: number;
  /** IPI no `det/imposto` da linha. */
  ipi_line: number;
  /** ICMS ST no `det/imposto` (vICMSST / vST) — igual ao XML do produto. */
  icms_st_line: number;
  /** FCP ST no `det/imposto` (vFCPST). */
  fcp_st_line: number;
  /** Rateios do ICMSTot + juros não presentes na linha. */
  outros: number;
  effective_total: number;
  effective_unit_price: number | null;
};

export type NfeUnitPricePreviewLine = {
  line_index: number;
  n_item: string | null;
  c_prod: string | null;
  product_name: string | null;
  cfop: string | null;
  is_bonification: boolean;
  uses_un_tax_base: boolean;
  unit_commercial: string | null;
  unit_tax: string | null;
  quantity_used: number;
  unit_value_used: number;
  effective_unit_price: number | null;
  effective_line_total: number | null;
  row: NfeUnitPricePreviewRow | null;
  steps: NfeUnitPricePreviewStep[];
};

export type NfeUnitPricePreviewNota = {
  v_nf: number | null;
  /** ICMSTot vOutro (outras despesas acessórias). */
  v_outro_icms_tot: number;
  /** Soma da coluna Outros (deve coincidir com v_outro_icms_tot). */
  soma_coluna_outros: number;
  /** Soma do total efetivo das linhas CFOP 5910 (bonificação). */
  soma_bonificacao_5910: number;
  /** vNF − soma_bonificacao_5910 (valor cobrado / real da nota). */
  valor_real_nota: number | null;
  /** Soma do total efetivo das linhas cobradas (CFOP ≠ 5910). */
  soma_total_efetivo_cobrado: number;
};

export type NfeUnitPricePreviewResult = {
  formula: string;
  global_juros_nota: number;
  nota: NfeUnitPricePreviewNota;
  lines: NfeUnitPricePreviewLine[];
};

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

function buildSteps(
  b: EffectiveUnitPriceBreakdown,
  qtyLabel: string,
): NfeUnitPricePreviewStep[] {
  const steps: NfeUnitPricePreviewStep[] = [
    {
      label: "Base (quantidade × valor unitário)",
      amount: b.gross,
      effect: "base",
      detail: `${b.quantity} ${qtyLabel} × ${b.unit_value}`,
    },
  ];
  if (b.line_discount > 0) {
    steps.push({
      label: "Desconto (vDesc)",
      amount: b.line_discount,
      effect: "subtract",
      detail: "Subtrai do valor da linha",
    });
  }
  if (b.line_ipi > 0) {
    steps.push({
      label: "IPI na linha",
      amount: b.line_ipi,
      effect: "add",
      detail: "Campo vIPI em det/imposto",
    });
  }
  if (b.line_icms_st > 0) {
    steps.push({
      label: "ICMS ST na linha",
      amount: b.line_icms_st,
      effect: "add",
      detail: "Campo vICMSST em det/imposto",
    });
  }
  if (b.line_fcp_st > 0) {
    steps.push({
      label: "FCP ST na linha",
      amount: b.line_fcp_st,
      effect: "add",
      detail: "Campo vFCPST em det/imposto",
    });
  }
  if (b.line_juros > 0) {
    steps.push({
      label: "Juros na linha",
      amount: b.line_juros,
      effect: "add",
      detail: null,
    });
  }
  steps.push({
    label: "Subtotal da linha (antes do rateio global)",
    amount: b.line_net_before_global,
    effect: "subtotal",
    detail: null,
  });
  if (b.global_ipi_allocation > 0) {
    steps.push({
      label: "IPI rateado (ICMSTot)",
      amount: b.global_ipi_allocation,
      effect: "add",
      detail: "Excedente de vIPI no total da nota, proporcional ao vProd",
    });
  }
  if (b.global_icms_st_allocation > 0) {
    steps.push({
      label: "ICMS ST rateado (ICMSTot)",
      amount: b.global_icms_st_allocation,
      effect: "add",
      detail: "Excedente de vST no total da nota, proporcional ao vProd",
    });
  }
  if (b.global_fcp_st_allocation > 0) {
    steps.push({
      label: "FCP ST rateado (ICMSTot)",
      amount: b.global_fcp_st_allocation,
      effect: "add",
      detail: "Excedente de vFCPST no total da nota, proporcional ao vProd",
    });
  }
  if (b.global_juros_allocation > 0) {
    steps.push({
      label: "Juros rateados (cobrança)",
      amount: b.global_juros_allocation,
      effect: "add",
      detail: "Soma das parcelas (dup) acima do vNF, rateado por vProd",
    });
  }
  if (b.global_voutro_allocation > 0) {
    steps.push({
      label: "Outras despesas (vOutro rateado)",
      amount: b.global_voutro_allocation,
      effect: "add",
      detail: "ICMSTot vOutro proporcional ao vProd da linha (sem CFOP 5910)",
    });
  }
  steps.push({
    label: "Total efetivo da linha",
    amount: b.effective_line_total,
    effect: "subtotal",
    detail: null,
  });
  steps.push({
    label: "Valor unitário efetivo",
    amount:
      b.quantity > 0
        ? Math.round((b.effective_line_total / b.quantity) * 1_000_000) /
          1_000_000
        : 0,
    effect: "result",
    detail: `Total efetivo ÷ ${b.quantity} ${qtyLabel}`,
  });
  return steps;
}

function buildPreviewRow(
  b: EffectiveUnitPriceBreakdown,
): NfeUnitPricePreviewRow {
  const qty = b.quantity;
  const effectiveUnitPrice =
    qty > 0
      ? Math.round((b.effective_line_total / qty) * 1_000_000) / 1_000_000
      : null;
  return {
    quantity: qty,
    gross: b.gross,
    discount: b.line_discount,
    ipi_line: b.line_ipi,
    icms_st_line: b.line_icms_st,
    fcp_st_line: b.line_fcp_st,
    outros: b.global_voutro_allocation,
    effective_total: b.effective_line_total,
    effective_unit_price: effectiveUnitPrice,
  };
}

function roundMoney(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function buildNfeUnitPricePreviewFromXml(
  xmlText: string,
): NfeUnitPricePreviewResult | null {
  const parsed = parseNfeXmlForUnifiedCatalog(xmlText);
  if (!parsed || parsed.lines.length === 0) return null;

  const pricing = computeNfeEffectivePricingForXml(xmlText, parsed.lines);
  if (!pricing) return null;
  const prices = pricing.prices;
  const globalJuros = extractNfeJurosFromXml(xmlText);
  const totals = extractNfeTaxTotalsFromXml(xmlText);
  const vNf = totals?.vNF != null && totals.vNF > 0 ? totals.vNF : null;
  const vOutroIcmsTot = totals?.vOutro != null && totals.vOutro > 0
    ? totals.vOutro
    : 0;

  const lines: NfeUnitPricePreviewLine[] = parsed.lines.map((line, lineIndex) => {
    const prod = line.prod;
    const uCom = str(prod.uCom);
    const uTrib = str(prod.uTrib);
    const cfop = normalizeCfop4(
      line.cfop ?? str(prod.CFOP ?? prod.cfop),
    );
    const isBonification = isNfeBonificationCfop(cfop);
    const useUn = nfeUsesUnTaxUnitBase(uCom, uTrib);
    const qtyLabel = useUn
      ? (uTrib ?? "UN")
      : (uCom ?? uTrib ?? "un");
    const priceRow = prices[lineIndex];
    const b = priceRow?.breakdown;

    return {
      line_index: lineIndex,
      n_item: line.nItem,
      c_prod: str(prod.cProd ?? prod.cprod),
      product_name: str(prod.xProd),
      cfop,
      is_bonification: isBonification,
      uses_un_tax_base: useUn,
      unit_commercial: uCom,
      unit_tax: uTrib && uCom && uTrib !== uCom ? uTrib : null,
      quantity_used: b?.quantity ?? 0,
      unit_value_used: b?.unit_value ?? 0,
      effective_unit_price: priceRow?.effectiveUnitPrice ?? null,
      effective_line_total: b?.effective_line_total ?? null,
      row: b ? buildPreviewRow(b) : null,
      steps: b ? buildSteps(b, qtyLabel) : [],
    };
  });

  let somaBonificacao5910 = 0;
  let somaCobrado = 0;
  let somaColunaOutros = 0;
  for (const ln of lines) {
    const t = ln.row?.effective_total ?? ln.effective_line_total ?? 0;
    const o = ln.row?.outros ?? 0;
    if (o > 0) somaColunaOutros += o;
    if (!(t > 0)) continue;
    if (ln.is_bonification) somaBonificacao5910 += t;
    else somaCobrado += t;
  }
  somaBonificacao5910 = Math.round(somaBonificacao5910 * 100) / 100;
  somaCobrado = Math.round(somaCobrado * 100) / 100;
  somaColunaOutros = Math.round(somaColunaOutros * 100) / 100;
  const valorRealNota =
    pricing.documentTotal ??
    (vNf != null
      ? Math.round((vNf - somaBonificacao5910) * 100) / 100
      : null);

  return {
    formula:
      "((qtd × valor unitário) − desconto + IPI + ICMS ST + FCP ST + juros + vOutro rateado) ÷ qtd — coluna Outros = ICMSTot vOutro rateado por vProd (sem CFOP 5910)",
    global_juros_nota: globalJuros,
    nota: {
      v_nf: vNf,
      v_outro_icms_tot: vOutroIcmsTot,
      soma_coluna_outros: somaColunaOutros,
      soma_bonificacao_5910: somaBonificacao5910,
      valor_real_nota: valorRealNota,
      soma_total_efetivo_cobrado: somaCobrado,
    },
    lines,
  };
}

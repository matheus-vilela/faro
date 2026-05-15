import type { ExtractedExpenseItemWithMatch } from "@/lib/whatsappExtractedExpense";

function roundMoney2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function numFromUnknown(v: unknown): number {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/** Motivos comuns quando total da nota ≠ soma das linhas importadas. */
export const EXPENSE_DIVERGENCE_REASONS = [
  { value: "imposto", label: "Impostos (ICMS, IPI, PIS/COFINS, etc.)" },
  { value: "taxa", label: "Taxas ou serviços embutidos na nota" },
  { value: "frete", label: "Frete ou logística" },
  { value: "desconto", label: "Descontos ou abatimentos" },
  { value: "bonificacao", label: "Bonificação ou brinde" },
  { value: "arredondamento", label: "Arredondamento ou diferença de centavos" },
  { value: "outro", label: "Outro motivo" },
] as const;

export function divergenceReasonLabel(value: string): string {
  const row = EXPENSE_DIVERGENCE_REASONS.find((r) => r.value === value);
  return row?.label ?? value;
}

export function valuesDivergeCents(
  totalNota: number,
  sumItens: number,
  toleranceCents = 2,
): boolean {
  return (
    Math.abs(Math.round(totalNota * 100) - Math.round(sumItens * 100)) >
    toleranceCents
  );
}

export type NfeExpenseValueBreakdown = {
  documentTotal: number | null;
  sumItems: number;
  ipi: number;
  desconto: number;
  /** Σ linhas + IPI + desconto (vDesc XML, positivo = abatimento) — informativo. */
  composite: number;
  /** Total da nota − composite — informativo quando há ICMSTot. */
  residual: number | null;
  /** Existe objeto `icms_tot` no JSON da despesa (totais do XML). */
  hasIcmsBreakdown: boolean;
  /**
   * Só alerta quando **não** há ICMSTot no registro e o total do documento difere da soma das linhas.
   * Com ICMSTot, os valores do XML são tomados como referência correta.
   */
  needsAttention: boolean;
};

/** `icms_tot` gravado na despesa (snapshot do XML). */
export function icmsTotXmlPresent(
  financialReconciliationJson?: Record<string, unknown> | null,
): boolean {
  const icms = financialReconciliationJson?.icms_tot;
  if (icms == null || typeof icms !== "object" || Array.isArray(icms)) return false;
  return Object.keys(icms as Record<string, unknown>).length > 0;
}

/**
 * Conferência de valores: com **ICMSTot** no JSON, não alerta divergência (totais do XML são a referência).
 * Sem ICMSTot, compara total do documento à soma das linhas (centavos).
 */
export function getNfeExpenseValueBreakdown(input: {
  documentTotal: number | null | undefined;
  sumItems: number;
  financialReconciliationJson?: Record<string, unknown> | null;
}): NfeExpenseValueBreakdown {
  const sumItems = roundMoney2(Number(input.sumItems) || 0);
  const docRaw = input.documentTotal;
  const documentTotal =
    docRaw != null && Number.isFinite(Number(docRaw)) ? roundMoney2(Number(docRaw)) : null;

  const objRaw = input.financialReconciliationJson?.icms_tot;
  const obj =
    objRaw && typeof objRaw === "object" && !Array.isArray(objRaw)
      ? (objRaw as Record<string, unknown>)
      : null;
  const ipi = obj ? roundMoney2(numFromUnknown(obj.vIPI)) : 0;
  const desconto = obj ? roundMoney2(numFromUnknown(obj.vDesc)) : 0;
  const hasIcmsBreakdown = icmsTotXmlPresent(input.financialReconciliationJson ?? null);
  const composite = roundMoney2(sumItems + ipi + desconto);
  const residual = documentTotal != null ? roundMoney2(documentTotal - composite) : null;

  const needsAttention =
    documentTotal != null &&
    !hasIcmsBreakdown &&
    valuesDivergeCents(documentTotal, sumItems, 2);

  return {
    documentTotal,
    sumItems,
    ipi,
    desconto,
    composite,
    residual,
    hasIcmsBreakdown,
    needsAttention,
  };
}

/** Linha que ainda precisa de conferência humana (vínculo, unidade ou novo produto). */
export function itemLineNeedsProductReview(
  it: ExtractedExpenseItemWithMatch,
): boolean {
  if (it.productId) {
    const m = it.productMatch;
    if (m?.needsConfirmation === false) return false;
  }
  return (
    !it.productId || it.productMatch?.needsConfirmation === true
  );
}

export function countLinesNeedingProductReview(
  items: ExtractedExpenseItemWithMatch[],
): number {
  return items.filter(itemLineNeedsProductReview).length;
}

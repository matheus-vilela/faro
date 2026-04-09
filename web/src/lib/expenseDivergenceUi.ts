import type { ExtractedExpenseItemWithMatch } from "@/lib/whatsappExtractedExpense";

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

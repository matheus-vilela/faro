import type { Boleto } from "@/types/expense";

/** Boletos gerados só para DRE (taxas/deduções de receita), fora do fluxo de caixa. */
export function isRevenueTaxDeductionBoletoDescription(description: string): boolean {
  const d = description.trim();
  if (!d) return false;
  return (
    /^Taxas\/Dedu/i.test(d) ||
    /^Despesa:\s*Taxas\/Dedu/i.test(d) ||
    /\s-\s*Taxas\/dedu[cç][oõ]es\s*$/i.test(d)
  );
}

export function boletoVisibleInFluxo(
  b: Pick<Boleto, "exclude_from_fluxo" | "description">,
): boolean {
  if (b.exclude_from_fluxo === true) return false;
  return !isRevenueTaxDeductionBoletoDescription(b.description ?? "");
}

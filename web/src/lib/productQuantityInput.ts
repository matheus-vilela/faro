/**
 * Passo e mínimo para input de quantidade conforme unidade do produto.
 * Unidade (`un`): incrementos inteiros; demais: decimais.
 */
export function quantityInputPropsForUnit(unit: string | undefined): {
  step: number;
  min: number;
  integerOnly: boolean;
} {
  const u = (unit ?? "un").toLowerCase();
  if (u === "un") {
    return { step: 1, min: 1, integerOnly: true };
  }
  return { step: 0.01, min: 0.01, integerOnly: false };
}

export function parseQuantityForUnit(
  raw: string,
  unit: string | undefined,
): number {
  const { integerOnly } = quantityInputPropsForUnit(unit);
  const n = parseFloat(raw.replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  if (integerOnly) return Math.max(1, Math.round(n));
  return Math.max(0, n);
}

/** Quantidade de estoque do cadastro: número finito, inclusive negativo. */
export function parseCatalogStockQuantity(raw: string): number | null {
  const n = parseFloat(String(raw ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Compara o preço do formulário (centavos) com o valor gravado (até 8 casas). */
export function catalogLastUnitValueChanged(
  parsedFromForm: number | null,
  stored: number | null,
): boolean {
  if (parsedFromForm == null && stored == null) return false;
  if (parsedFromForm == null || stored == null) return true;
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  return round2(parsedFromForm) !== round2(stored);
}

export function catalogUnitCodesDiffer(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return (a ?? "").trim().toLowerCase() !== (b ?? "").trim().toLowerCase();
}

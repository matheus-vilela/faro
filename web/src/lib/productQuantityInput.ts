/**
 * Quantidade já na unidade de estoque do produto (hub), após conversão.
 * Usa 3 casas decimais (ex.: 200 g com 1 un = 300 g → 0,667 un).
 */
export function roundHubQuantityForStock(q: number): number {
  if (!Number.isFinite(q)) return q;
  return Math.round(q * 1000) / 1000;
}

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

/**
 * Input de quantidade na venda/compra: quando a unidade de lançamento é a mesma
 * que o estoque em `un`, exige inteiro; ao vender em g com estoque em `un`, permite decimais no lançamento.
 */
export function quantityInputPropsForSaleUnit(
  saleUnit: string | undefined,
  hubUnit: string | undefined,
): { step: number; min: number; integerOnly: boolean } {
  const s = (saleUnit ?? hubUnit ?? "un").trim().toLowerCase();
  const h = (hubUnit ?? "un").trim().toLowerCase();
  if (h === "un" && s === "un") {
    return { step: 1, min: 1, integerOnly: true };
  }
  if (s === "kg" || s === "l") {
    return { step: 0.001, min: 0.001, integerOnly: false };
  }
  if (s === "g" || s === "mg" || s === "ml") {
    return { step: 1, min: 1, integerOnly: false };
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

export function parseSaleQuantity(
  raw: string,
  saleUnit: string | undefined,
  hubUnit: string | undefined,
): number {
  const { integerOnly } = quantityInputPropsForSaleUnit(saleUnit, hubUnit);
  const n = parseFloat(raw.replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  if (integerOnly) return Math.max(1, Math.round(n));
  return Math.max(0, n);
}

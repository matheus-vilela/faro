/** Linha de CMV gravada na venda (`revenue_entries.cmv_lines`). */
export interface RevenueCmvLine {
  product_id: string;
  product_name?: string;
  /** Quantidade na unidade de estoque usada no cálculo. */
  quantity: number;
  unit_code: string;
  sale_unit_code?: string;
  sale_quantity?: number;
  unit_cost: number;
  /** CMV da linha (quantity × unit_cost, arredondado). */
  amount: number;
  composes_cmv?: boolean;
}

export function parseRevenueCmvLines(raw: unknown): RevenueCmvLine[] {
  if (!Array.isArray(raw)) return [];
  const out: RevenueCmvLine[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const productId = String(o.product_id ?? "");
    if (!productId) continue;
    out.push({
      product_id: productId,
      product_name:
        typeof o.product_name === "string" ? o.product_name : undefined,
      quantity: Number(o.quantity) || 0,
      unit_code: String(o.unit_code ?? "un"),
      sale_unit_code:
        typeof o.sale_unit_code === "string" ? o.sale_unit_code : undefined,
      sale_quantity:
        o.sale_quantity != null ? Number(o.sale_quantity) : undefined,
      unit_cost: Number(o.unit_cost) || 0,
      amount: Number(o.amount) || 0,
      composes_cmv: o.composes_cmv !== false,
    });
  }
  return out;
}

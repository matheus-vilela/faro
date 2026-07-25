/**
 * Cria produto + movimentação de entrada na mesma transação (RPC Postgres).
 */

// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

export type CreateProductWithStockInInput = {
  companyId: string;
  product: Record<string, unknown>;
  quantity: number;
  unitValue?: number | null;
  referenceType?: string;
  referenceId?: string | null;
  unitConversions?: Array<{
    primary_qty: number;
    primary_unit_code: string;
    secondary_qty: number;
    secondary_unit_code: string;
  }>;
};

export type CreateProductWithStockInResult = {
  productId: string | null;
  error: string | null;
};

/** Insert atômico: produto + stock_movements (in). Falha de um reverte o outro. */
export async function createProductWithStockIn(
  admin: SupabaseAdmin,
  input: CreateProductWithStockInInput,
): Promise<CreateProductWithStockInResult> {
  const qty = Number(input.quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    return {
      productId: null,
      error: `quantidade de entrada inválida: ${input.quantity}`,
    };
  }

  const productPayload: Record<string, unknown> = { ...input.product };
  delete productPayload.company_id;
  delete productPayload.current_quantity;
  delete productPayload.estoque_entrada_preview;
  if (input.unitConversions && input.unitConversions.length > 0) {
    productPayload.unit_conversions = input.unitConversions;
  }

  const unitValue =
    input.unitValue != null && Number.isFinite(Number(input.unitValue))
      ? Number(input.unitValue)
      : null;

  const { data, error } = await admin.rpc("create_product_with_stock_in", {
    p_company_id: input.companyId,
    p_product: productPayload,
    p_quantity: qty,
    p_unit_value: unitValue,
    p_reference_type: input.referenceType ?? "nfe_product_create",
    p_reference_id: input.referenceId ?? null,
  });

  if (error) {
    return { productId: null, error: error.message };
  }
  if (data == null || String(data).trim() === "") {
    return { productId: null, error: "RPC não devolveu product_id" };
  }
  return { productId: String(data), error: null };
}

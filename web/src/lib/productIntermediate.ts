import { supabase } from "@/lib/supabase";

export const INTERMEDIATE_STOCK_CONTROL = "INTERMEDIATE";

export const INTERMEDIATE_BADGE_CLASS =
  "border-teal-500/40 bg-teal-500/10 text-teal-950 dark:text-teal-100";

export function isIntermediateProduct(product: {
  stock_control_type?: string | null;
}): boolean {
  return product.stock_control_type === INTERMEDIATE_STOCK_CONTROL;
}

export type TechnicalSheetKind = "sale" | "intermediate";

export function produceErrorMessage(code: string | undefined): string {
  switch (code) {
    case "invalid_quantity":
      return "Informe uma quantidade maior que zero.";
    case "not_intermediate":
      return "Só é possível produzir um produto intermediário.";
    case "recipe_not_found":
      return "Este produto ainda não tem ficha de produção.";
    case "missing_conversion":
      return "Falta conversão de unidade em um insumo. Cadastre no produto.";
    case "forbidden":
      return "Sem permissão para esta unidade.";
    case "not_authenticated":
      return "Sessão expirada. Entre novamente.";
    case "product_not_found":
      return "Produto não encontrado.";
    default:
      if (code?.includes("insufficient_stock")) {
        return "Estoque insuficiente em um ou mais insumos.";
      }
      return code ?? "Não foi possível produzir.";
  }
}

export async function produceIntermediateProduct(
  companyId: string,
  productId: string,
  quantity: number,
): Promise<{ ok: boolean; error?: string; unit_cost?: number | null }> {
  const { data, error } = await supabase.rpc("produce_intermediate_product", {
    p_company_id: companyId,
    p_product_id: productId,
    p_quantity: quantity,
  });
  if (error) return { ok: false, error: error.message };

  const row = data as {
    ok?: boolean;
    error?: string;
    message?: string;
    unit_cost?: number | null;
  };
  if (!row?.ok) {
    return {
      ok: false,
      error: produceErrorMessage(row?.error ?? row?.message),
    };
  }
  return {
    ok: true,
    unit_cost: row.unit_cost != null ? Number(row.unit_cost) : null,
  };
}

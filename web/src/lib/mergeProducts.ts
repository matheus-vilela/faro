import { supabase } from "@/lib/supabase";

export type MergeProductsResult =
  | { ok: true; winnerId: string; mergedNames: string[] }
  | { ok: false; error: string };

export async function mergeCompanyProducts(
  companyId: string,
  winnerId: string,
  loserId: string,
): Promise<MergeProductsResult> {
  const { data, error } = await supabase.rpc("merge_company_products", {
    p_company_id: companyId,
    p_winner_id: winnerId,
    p_loser_id: loserId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const row = data as {
    ok?: boolean;
    error?: string;
    message?: string;
    winner_id?: string;
    merged_names?: string[];
  } | null;

  if (!row?.ok) {
    const code = String(row?.error ?? "merge_failed");
    const messages: Record<string, string> = {
      same_product: "Selecione um produto diferente.",
      not_authenticated: "Sessão expirada. Entre novamente.",
      forbidden: "Sem permissão para unificar produtos nesta unidade.",
      product_not_found: "Produto não encontrado.",
      company_mismatch: "Os produtos não pertencem à mesma unidade.",
    };
    return {
      ok: false,
      error: messages[code] ?? row?.message ?? code,
    };
  }

  return {
    ok: true,
    winnerId: String(row.winner_id ?? winnerId),
    mergedNames: Array.isArray(row.merged_names)
      ? row.merged_names.map(String)
      : [],
  };
}

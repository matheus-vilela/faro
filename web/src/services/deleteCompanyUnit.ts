import { mapCompanyUnitMutationError } from "@/lib/companyUnitName";
import { supabase } from "@/lib/supabase";

export async function deleteCompanyUnit(
  companyId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("delete_company_unit", {
    p_company_id: companyId,
  });
  if (error) {
    return {
      ok: false,
      error: mapCompanyUnitMutationError(error, "Erro ao remover unidade"),
    };
  }
  const row =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  if (!row || row.ok !== true) {
    const fromRow = typeof row?.error === "string" ? row.error : "";
    return {
      ok: false,
      error: fromRow || "Erro ao remover unidade",
    };
  }
  return { ok: true };
}

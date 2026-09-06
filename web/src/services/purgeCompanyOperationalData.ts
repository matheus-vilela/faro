import { supabase } from "@/lib/supabase";

export function companyPurgeConfirmMatches(
  companyName: string,
  typed: string,
): boolean {
  return typed.trim().toLowerCase() === companyName.trim().toLowerCase();
}

export async function purgeActiveCompanyOperationalData(
  companyId: string,
  confirmName: string,
): Promise<{ ok: true; rowsDeleted: number } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc(
    "purge_active_company_operational_data",
    {
      p_company_id: companyId,
      p_confirm: confirmName,
    },
  );
  if (error) {
    return { ok: false, error: error.message };
  }
  const row =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  if (!row || row.ok !== true) {
    const code = typeof row?.error === "string" ? row.error : "";
    const messages: Record<string, string> = {
      not_authenticated: "Sessão expirada. Entre novamente.",
      forbidden: "Sem permissão para limpar esta unidade.",
      company_not_found: "Unidade não encontrada.",
      confirm_mismatch: "O nome digitado não confere com a unidade.",
    };
    return {
      ok: false,
      error:
        messages[code] ??
        (code || "Não foi possível limpar os dados da unidade."),
    };
  }
  return {
    ok: true,
    rowsDeleted: Number(row.rows_deleted ?? 0) || 0,
  };
}

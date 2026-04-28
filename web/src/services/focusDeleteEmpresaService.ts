import { supabase, supabaseAnonKey, supabaseUrl } from "@/lib/supabase";

const FN_PATH = "/functions/v1/focus-delete-empresa";

export async function focusDeleteEmpresa(input: {
  companyId: string;
}): Promise<
  | { ok: true; skipped?: boolean; already_deleted?: boolean }
  | { ok: false; error: string }
> {
  const { data: sessData, error: sessErr } = await supabase.auth.getSession();
  const accessToken = sessData.session?.access_token;
  if (sessErr || !accessToken) {
    return {
      ok: false,
      error: "Sessão inválida ou expirada. Entre novamente.",
    };
  }

  const base = supabaseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    apikey: supabaseAnonKey,
    "Content-Type": "application/json",
  };

  const res = await fetch(`${base}${FN_PATH}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ company_id: input.companyId }),
  });

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return { ok: false, error: "Resposta inválida do servidor." };
  }

  const o =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};

  if (!res.ok || o.ok !== true) {
    const msg =
      (typeof o.error === "string" && o.error) ||
      (typeof o.message === "string" && o.message) ||
      res.statusText ||
      "Falha ao remover empresa na Focus.";
    return { ok: false, error: msg };
  }

  return {
    ok: true,
    skipped: o.skipped === true,
    already_deleted: o.already_deleted === true,
  };
}

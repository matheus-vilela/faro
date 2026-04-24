import { supabase, supabaseAnonKey, supabaseUrl } from "@/lib/supabase";

const FN_PATH = "/functions/v1/focus-atualizar-certificado";

export function hasFocusNfeEmpresaId(focusnfe: unknown): boolean {
  const o =
    focusnfe && typeof focusnfe === "object" && !Array.isArray(focusnfe)
      ? (focusnfe as Record<string, unknown>)
      : {};
  const raw = o.id_empresa;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return true;
  if (typeof raw === "string" && raw.trim().length > 0) return true;
  return false;
}

/**
 * Atualiza ou remove certificado A1 na empresa Focus (PUT /v2/empresas/{id}).
 * A edge resolve `id_empresa` a partir de `companies.focusnfe` (não confiar no cliente).
 */
export async function focusAtualizarCertificado(input: {
  companyId: string;
  removeCertificate: boolean;
  arquivo_certificado_base64?: string;
  senha_certificado?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
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

  const body: Record<string, unknown> = {
    company_id: input.companyId,
    remove_certificate: input.removeCertificate,
  };
  if (!input.removeCertificate) {
    body.arquivo_certificado_base64 = input.arquivo_certificado_base64 ?? "";
    body.senha_certificado = input.senha_certificado ?? "";
  }

  const res = await fetch(`${base}${FN_PATH}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
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

  if (!res.ok) {
    const msg =
      (typeof o.error === "string" && o.error) ||
      (typeof o.message === "string" && o.message) ||
      res.statusText ||
      "Falha ao atualizar certificado na Focus.";
    return { ok: false, error: msg };
  }

  if (o.ok !== true) {
    return {
      ok: false,
      error:
        (typeof o.error === "string" && o.error) ||
        "A Focus não confirmou a atualização do certificado.",
    };
  }

  return { ok: true };
}

import { supabase, supabaseAnonKey, supabaseUrl } from "@/lib/supabase";

export function buildCertificateDelegationPublicUrl(token: string): string {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://app.faro.ai";
  return `${origin}/certificado-onboarding/${token}`;
}

export async function createSetupCertificateDelegationLink(
  companyId: string,
): Promise<
  | { ok: true; linkId: string; token: string; url: string }
  | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc(
    "create_setup_certificate_delegation_link",
    { p_company_id: companyId },
  );
  if (error) return { ok: false, error: error.message };
  const o = data as Record<string, unknown> | null;
  if (!o?.ok) {
    return {
      ok: false,
      error: typeof o?.error === "string" ? o.error : "Não foi possível gerar o link.",
    };
  }
  const token = String(o.token ?? "");
  const linkId = String(o.link_id ?? "");
  if (!token || !linkId) {
    return { ok: false, error: "Resposta inválida ao gerar o link." };
  }
  return {
    ok: true,
    linkId,
    token,
    url: buildCertificateDelegationPublicUrl(token),
  };
}

export async function getActiveSetupCertificateDelegationLink(
  companyId: string,
): Promise<
  | { ok: true; linkId: string; token: string; url: string }
  | { ok: false; error: string }
> {
  const { data, error } = await supabase.rpc(
    "get_active_setup_certificate_delegation_link",
    { p_company_id: companyId },
  );
  if (error) return { ok: false, error: error.message };
  const o = data as Record<string, unknown> | null;
  if (!o?.ok) {
    return { ok: false, error: "not_found" };
  }
  const token = String(o.token ?? "");
  const linkId = String(o.link_id ?? "");
  if (!token || !linkId) {
    return { ok: false, error: "not_found" };
  }
  return {
    ok: true,
    linkId,
    token,
    url: buildCertificateDelegationPublicUrl(token),
  };
}

export async function getSetupCertificateDelegationPublic(
  token: string,
): Promise<
  | { ok: true; companyName: string }
  | { ok: false; error: string }
> {
  const { supabasePublic } = await import("@/lib/supabasePublic");
  const { data, error } = await supabasePublic.rpc(
    "get_setup_certificate_delegation_public",
    { p_token: token },
  );
  if (error) return { ok: false, error: error.message };
  const o = data as Record<string, unknown> | null;
  if (!o?.ok) {
    const code = typeof o?.error === "string" ? o.error : "not_found";
    return { ok: false, error: code };
  }
  return {
    ok: true,
    companyName: String(o.company_name ?? "Unidade"),
  };
}

const SUBMIT_FN = "/functions/v1/focus-submit-delegated-certificado";

export async function submitDelegatedCertificate(
  token: string,
  certBase64: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = supabaseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}${SUBMIT_FN}`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      token,
      arquivo_certificado_base64: certBase64.trim(),
      senha_certificado: password.trim(),
    }),
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
    return {
      ok: false,
      error:
        (typeof o.error === "string" && o.error) ||
        "Não foi possível validar o certificado.",
    };
  }
  return { ok: true };
}

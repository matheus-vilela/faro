import { supabase, supabaseAnonKey, supabaseUrl } from "@/lib/supabase";
import type { FocusCnpjConsultaData } from "@/types/focusCnpjConsulta";

const FN_PATH = "/functions/v1/focus-consulta-cnpj";

function onlyDigitsCnpj(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 14);
}

function parseJsonBody(data: unknown): {
  ok?: boolean;
  error?: string;
  data?: FocusCnpjConsultaData;
} {
  if (!data || typeof data !== "object") {
    return { ok: false, error: "Resposta inválida do servidor." };
  }
  const o = data as Record<string, unknown>;
  return {
    ok: o.ok === true,
    error: typeof o.error === "string" ? o.error : undefined,
    data:
      o.data && typeof o.data === "object"
        ? (o.data as FocusCnpjConsultaData)
        : undefined,
  };
}

/**
 * Consulta CNPJ na Focus via edge function `focus-consulta-cnpj`.
 * Autenticação: JWT do usuário (mesmo padrão de `parse-expense-document`).
 * Tenta GET `?cnpj=` e, em caso de método não permitido, POST JSON `{ cnpj }`.
 */
export async function consultarCnpjNaFocus(
  cnpj: string,
): Promise<
  { ok: true; data: FocusCnpjConsultaData } | { ok: false; error: string }
> {
  const digits = onlyDigitsCnpj(cnpj);
  if (digits.length !== 14) {
    return { ok: false, error: "Informe um CNPJ com 14 dígitos para validar." };
  }

  const { data: sessData, error: sessErr } = await supabase.auth.getSession();
  const accessToken = sessData.session?.access_token;
  if (sessErr || !accessToken) {
    return {
      ok: false,
      error:
        "Sessão inválida ou expirada. Entre novamente e tente validar o CNPJ.",
    };
  }

  const base = supabaseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    apikey: supabaseAnonKey,
  };

  const urlGet = `${base}${FN_PATH}?cnpj=${encodeURIComponent(digits)}`;

  let res = await fetch(urlGet, { method: "GET", headers });

  if (res.status === 405) {
    res = await fetch(`${base}${FN_PATH}`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cnpj: digits }),
    });
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "Resposta inválida do servidor." };
  }

  const parsed = parseJsonBody(body);
  if (!res.ok) {
    const msg =
      parsed.error ||
      (typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof (body as { message: unknown }).message === "string"
        ? (body as { message: string }).message
        : null) ||
      res.statusText ||
      "Falha ao consultar CNPJ.";
    return { ok: false, error: msg };
  }

  if (!parsed.ok || !parsed.data) {
    return {
      ok: false,
      error: parsed.error ?? "Não foi possível obter os dados do CNPJ.",
    };
  }

  return { ok: true, data: parsed.data };
}

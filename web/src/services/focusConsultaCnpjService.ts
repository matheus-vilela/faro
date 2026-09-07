import { isValidCnpj } from "@/lib/cnpj";
import { INVALID_CNPJ_DIGITS_MSG } from "@/lib/companyUnitName";
import { supabase, supabaseAnonKey, supabaseUrl } from "@/lib/supabase";
import type { FocusCnpjConsultaData } from "@/types/focusCnpjConsulta";

const FN_PATH = "/functions/v1/focus-consulta-cnpj";

function onlyDigitsCnpj(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 14);
}

function asRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  return data as Record<string, unknown>;
}

function focusPayloadMessage(focus: unknown): string | null {
  const o = asRecord(focus);
  if (!o) {
    if (typeof focus === "string" && focus.trim()) return focus.trim();
    return null;
  }
  if (typeof o.mensagem === "string" && o.mensagem.trim()) {
    return o.mensagem.trim();
  }
  if (typeof o.message === "string" && o.message.trim()) {
    return o.message.trim();
  }
  if (typeof o.raw === "string" && /access denied/i.test(o.raw)) {
    return "A Focus recusou o token (HTTP Basic). Confira FOCUS_NFE_TOKEN e o ambiente (produção vs homologação).";
  }
  return null;
}

/** Mensagem para toast quando a edge/Focus devolve erro. */
export function messageFromConsultaCnpjFailure(
  body: unknown,
  httpStatus: number,
): string {
  const o = asRecord(body);
  if (typeof o?.error === "string" && o.error.trim()) return o.error.trim();
  if (typeof o?.message === "string" && o.message.trim()) {
    return o.message.trim();
  }
  const fromFocus = focusPayloadMessage(o?.focus);
  if (fromFocus) return fromFocus;
  if (httpStatus === 401) {
    return "Sessão inválida ou expirada. Entre novamente e tente validar o CNPJ.";
  }
  if (httpStatus === 403) {
    return "A Focus recusou a consulta de CNPJ (permissão). Confira o token da conta e se a aplicação não está bloqueada.";
  }
  if (httpStatus === 502) {
    return "A consulta de CNPJ na Focus falhou. Tente de novo; se persistir, o token ou o ambiente (homologação/produção) está incorreto.";
  }
  return "Falha ao consultar CNPJ.";
}

function parseJsonBody(data: unknown): {
  ok?: boolean;
  error?: string;
  data?: FocusCnpjConsultaData;
} {
  const o = asRecord(data);
  if (!o) {
    return { ok: false, error: "Resposta inválida do servidor." };
  }
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
 * Autenticação: JWT do usuário. Sempre POST — GET com `?cnpj=` costuma levar 403 no gateway.
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
  if (!isValidCnpj(digits)) {
    return { ok: false, error: INVALID_CNPJ_DIGITS_MSG };
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
  const res = await fetch(`${base}${FN_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ cnpj: digits }),
  });

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    if (res.status === 403) {
      return {
        ok: false,
        error:
          "A Focus recusou a consulta de CNPJ (permissão). Confira o token da conta e se a aplicação não está bloqueada.",
      };
    }
    return { ok: false, error: "Resposta inválida do servidor." };
  }

  const parsed = parseJsonBody(body);
  if (!res.ok) {
    return {
      ok: false,
      error: messageFromConsultaCnpjFailure(body, res.status),
    };
  }

  if (!parsed.ok || !parsed.data) {
    return {
      ok: false,
      error: parsed.error ?? "Não foi possível obter os dados do CNPJ.",
    };
  }

  return { ok: true, data: parsed.data };
}

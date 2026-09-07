/**
 * Proxy autenticado para consulta de CNPJ na API Focus NFe.
 * @see https://focusnfe.com.br/doc/#consulta-de-cnpj_resposta-da-api
 *
 * GET ou POST: CNPJ com 14 dígitos (somente números). GET usa ?cnpj=; POST usa JSON { "cnpj": "..." }.
 *
 * Secrets: FOCUS_NFE_TOKEN (conta Focus; opcional se o fallback Receita estiver ok).
 * Opcional: FOCUS_NFE_API_BASE. Se a Focus recusar (homologação/token), consulta BrasilAPI.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function normalizeCnpj(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 14) return null;
  return digits;
}

/** Dígitos verificadores do CNPJ (mesmo algoritmo de `web/src/lib/cnpj.ts`). */
function isValidCnpjDigits(c: string): boolean {
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;

  let length = 12;
  let numbers = c.substring(0, length);
  const dv = c.substring(12);
  let sum = 0;
  let pos = length - 7;
  for (let i = length; i >= 1; i--) {
    sum += parseInt(numbers.charAt(length - i), 10) * pos--;
    if (pos < 2) pos = 9;
  }
  let result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  if (result !== parseInt(dv.charAt(0), 10)) return false;

  length = 13;
  numbers = c.substring(0, length);
  sum = 0;
  pos = length - 7;
  for (let i = length; i >= 1; i--) {
    sum += parseInt(numbers.charAt(length - i), 10) * pos--;
    if (pos < 2) pos = 9;
  }
  result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
  return result === parseInt(dv.charAt(1), 10);
}

function focusBasicAuthHeader(token: string): string {
  const pair = `${token}:`;
  const bytes = new TextEncoder().encode(pair);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return `Basic ${btoa(binary)}`;
}

/** Remove barra final e `/v2` duplicado (secret às vezes já inclui o path). */
function normalizeFocusApiBase(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v2$/i, "");
}

function focusHostCandidates(configured: string): string[] {
  const primary = normalizeFocusApiBase(
    configured || "https://api.focusnfe.com.br",
  );
  const production = "https://api.focusnfe.com.br";
  const homolog = "https://homologacao.focusnfe.com.br";
  const out: string[] = [primary];
  const other = /homologacao/i.test(primary) ? production : homolog;
  if (other !== primary) out.push(other);
  return out;
}

function focusErrorText(payload: unknown, httpStatus: number): string {
  const o =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  const msg =
    (typeof o?.mensagem === "string" && o.mensagem.trim()) ||
    (typeof o?.message === "string" && o.message.trim()) ||
    (typeof o?.raw === "string" && /access denied/i.test(o.raw)
      ? "A Focus recusou o token (HTTP Basic)."
      : "");
  if (msg) return msg;
  if (httpStatus === 401 || httpStatus === 403) {
    return "A Focus recusou a consulta de CNPJ (permissão).";
  }
  if (httpStatus === 404) {
    return "CNPJ não encontrado na base da Receita (Focus).";
  }
  return `Focus HTTP ${httpStatus}.`;
}

type FocusFetchResult =
  | { ok: true; data: unknown; host: string }
  | { ok: false; status: number; payload: unknown; host: string };

async function fetchFocusCnpj(
  apiBase: string,
  token: string,
  cnpj: string,
): Promise<FocusFetchResult> {
  const focusUrl = `${apiBase}/v2/cnpjs/${cnpj}`;
  let focusRes: Response;
  try {
    focusRes = await fetch(focusUrl, {
      method: "GET",
      headers: {
        Authorization: focusBasicAuthHeader(token),
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    console.error("[focus-consulta-cnpj] fetch Focus:", apiBase, e);
    return {
      ok: false,
      status: 502,
      payload: { raw: e instanceof Error ? e.message : String(e) },
      host: apiBase,
    };
  }
  const text = await focusRes.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!focusRes.ok) {
    return { ok: false, status: focusRes.status, payload, host: apiBase };
  }
  return { ok: true, data: payload, host: apiBase };
}

function strField(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function boolField(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  return undefined;
}

/** BrasilAPI (Receita) — mesmo formato que o wizard espera da Focus. */
function mapBrasilApiCnpj(raw: Record<string, unknown>, cnpj: string): Record<string, unknown> {
  const ibge = strField(raw.codigo_municipio_ibge);
  return {
    razao_social: strField(raw.razao_social),
    cnpj,
    situacao_cadastral: strField(raw.descricao_situacao_cadastral),
    cnae_principal: strField(raw.cnae_fiscal),
    optante_simples_nacional: boolField(raw.opcao_pelo_simples),
    optante_mei: boolField(raw.opcao_pelo_mei),
    endereco: {
      codigo_ibge: ibge,
      codigo_municipio: strField(raw.codigo_municipio) ?? ibge,
      nome_municipio: strField(raw.municipio),
      logradouro: strField(raw.logradouro),
      complemento: strField(raw.complemento),
      numero: strField(raw.numero),
      bairro: strField(raw.bairro),
      cep: strField(raw.cep)?.replace(/\D/g, ""),
      uf: strField(raw.uf),
    },
    nome_fantasia: strField(raw.nome_fantasia),
    _source: "brasilapi",
  };
}

async function fetchBrasilApiCnpj(
  cnpj: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    console.error("[focus-consulta-cnpj] BrasilAPI fetch:", e);
    return { ok: false, error: "Falha ao consultar CNPJ (fallback Receita)." };
  }
  const text = await res.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!res.ok) {
    const o = payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
    const msg =
      (typeof o?.message === "string" && o.message.trim()) ||
      (res.status === 404 ? "CNPJ não encontrado na Receita." : `Receita HTTP ${res.status}.`);
    return { ok: false, error: msg };
  }
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Resposta inválida da Receita." };
  }
  return {
    ok: true,
    data: mapBrasilApiCnpj(payload as Record<string, unknown>, cnpj),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const focusToken = Deno.env.get("FOCUS_NFE_TOKEN")?.trim();

  if (!supabaseUrl || !anonKey) {
    return json({ ok: false, error: "Configuração do servidor incompleta." }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "Não autenticado." }, 401);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return json({ ok: false, error: "Sessão inválida." }, 401);
  }

  let cnpjRaw = "";
  if (req.method === "GET") {
    const url = new URL(req.url);
    cnpjRaw = url.searchParams.get("cnpj")?.trim() ?? "";
  } else {
    try {
      const body = (await req.json()) as { cnpj?: string };
      cnpjRaw = typeof body.cnpj === "string" ? body.cnpj.trim() : "";
    } catch {
      return json({ ok: false, error: "JSON inválido." }, 400);
    }
  }

  const cnpj = normalizeCnpj(cnpjRaw);
  if (!cnpj) {
    return json(
      {
        ok: false,
        error: "Informe um CNPJ válido com 14 dígitos (apenas números, sem máscara).",
      },
      400,
    );
  }
  if (!isValidCnpjDigits(cnpj)) {
    return json({ ok: false, error: "CNPJ inválido. Confira os dígitos." }, 400);
  }

  const configuredBase = Deno.env.get("FOCUS_NFE_API_BASE")?.trim() ||
    "https://api.focusnfe.com.br";
  let lastFail: FocusFetchResult | null = null;
  if (focusToken) {
    const hosts = focusHostCandidates(configuredBase);
    for (const host of hosts) {
      const result = await fetchFocusCnpj(host, focusToken, cnpj);
      if (result.ok) {
        console.log("[focus-consulta-cnpj] Focus OK", host);
        return json({ ok: true, data: result.data });
      }
      console.error(
        "[focus-consulta-cnpj] Focus HTTP",
        result.status,
        result.host,
        result.payload,
      );
      lastFail = result;
      if (result.status === 404) break;
    }
  } else {
    console.warn("[focus-consulta-cnpj] FOCUS_NFE_TOKEN ausente; usando fallback.");
  }

  const fallback = await fetchBrasilApiCnpj(cnpj);
  if (fallback.ok) {
    console.log("[focus-consulta-cnpj] BrasilAPI OK (Focus indisponível)");
    return json({ ok: true, data: fallback.data });
  }

  const focusPart = lastFail
    ? focusErrorText(lastFail.payload, lastFail.status)
    : "Focus indisponível.";
  return json(
    {
      ok: false,
      error: `${focusPart} ${fallback.error}`.trim(),
      status: lastFail?.status ?? 502,
      focus: lastFail?.payload ?? null,
    },
    422,
  );
});

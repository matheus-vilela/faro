/**
 * Proxy autenticado para consulta de CNPJ na API Focus NFe.
 * @see https://focusnfe.com.br/doc/#consulta-de-cnpj_resposta-da-api
 *
 * GET ou POST: CNPJ com 14 dígitos (somente números). GET usa ?cnpj=; POST usa JSON { "cnpj": "..." }.
 *
 * Secrets: FOCUS_NFE_TOKEN (obrigatório). Opcional: FOCUS_NFE_API_BASE (padrão https://api.focusnfe.com.br).
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

function focusBasicAuthHeader(token: string): string {
  const pair = `${token}:`;
  const bytes = new TextEncoder().encode(pair);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return `Basic ${btoa(binary)}`;
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
  const apiBase = (Deno.env.get("FOCUS_NFE_API_BASE")?.trim() ||
    "https://api.focusnfe.com.br").replace(/\/$/, "");

  if (!supabaseUrl || !anonKey) {
    return json({ ok: false, error: "Configuração do servidor incompleta." }, 500);
  }
  if (!focusToken) {
    return json({ ok: false, error: "Integração Focus não configurada (FOCUS_NFE_TOKEN)." }, 503);
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

  const focusUrl = `${apiBase}/v2/cnpjs/${cnpj}`;
  let focusRes: Response;
  try {
    focusRes = await fetch(focusUrl, {
      method: "GET",
      headers: {
        Authorization: focusBasicAuthHeader(focusToken),
        Accept: "application/json",
      },
    });
  } catch (e) {
    console.error("[focus-consulta-cnpj] fetch Focus:", e);
    return json({ ok: false, error: "Falha ao contatar a API Focus." }, 502);
  }

  const text = await focusRes.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!focusRes.ok) {
    return json(
      {
        ok: false,
        status: focusRes.status,
        focus: payload,
      },
      focusRes.status >= 400 && focusRes.status < 600 ? focusRes.status : 502,
    );
  }

  return json({ ok: true, data: payload });
});

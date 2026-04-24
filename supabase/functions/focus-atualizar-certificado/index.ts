/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const FOCUS_BASE = "https://api.focusnfe.com.br";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function basicAuthHeader(token: string): string {
  const t = token.trim();
  const pair = `${t}:`;
  const b64 = btoa(pair);
  return `Basic ${b64}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const focusToken = Deno.env.get("FOCUS_NFE_TOKEN")?.trim();
  if (!supabaseUrl || !anonKey) {
    return json({ ok: false, error: "Configuração do servidor incompleta." }, 500);
  }
  if (!focusToken) {
    return json(
      { ok: false, error: "FOCUS_NFE_TOKEN não configurado." },
      503,
    );
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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400);
  }

  const companyId =
    typeof body.company_id === "string" ? body.company_id.trim() : "";
  const removeCertificate = body.remove_certificate === true;
  const b64 =
    typeof body.arquivo_certificado_base64 === "string"
      ? body.arquivo_certificado_base64.trim()
      : "";
  const senha =
    typeof body.senha_certificado === "string"
      ? body.senha_certificado.trim()
      : "";

  if (!companyId) {
    return json({ ok: false, error: "company_id é obrigatório." }, 400);
  }

  if (!removeCertificate) {
    if (!b64 || !senha) {
      return json(
        {
          ok: false,
          error:
            "Para enviar certificado, informe arquivo_certificado_base64 e senha_certificado.",
        },
        400,
      );
    }
  }

  const { data: row, error: rowErr } = await supabase
    .from("companies")
    .select("id, focusnfe")
    .eq("id", companyId)
    .maybeSingle();

  if (rowErr || !row) {
    return json(
      { ok: false, error: "Unidade não encontrada ou sem permissão." },
      403,
    );
  }

  const fn = row.focusnfe;
  const focusnfe =
    fn && typeof fn === "object" && !Array.isArray(fn)
      ? (fn as Record<string, unknown>)
      : {};
  const rawId = focusnfe.id_empresa;
  const focusEmpresaId =
    typeof rawId === "number" && Number.isFinite(rawId)
      ? String(Math.trunc(rawId))
      : typeof rawId === "string" && rawId.trim()
        ? rawId.trim()
        : "";

  if (!focusEmpresaId) {
    return json(
      {
        ok: false,
        error:
          "Esta unidade não possui id_empresa da Focus. Cadastre a empresa na Focus antes de atualizar o certificado.",
      },
      400,
    );
  }

  const focusBody: Record<string, unknown> = removeCertificate
    ? {
        arquivo_certificado_base64: "",
        senha_certificado: "",
      }
    : {
        arquivo_certificado_base64: b64,
        senha_certificado: senha,
      };

  const url = `${FOCUS_BASE}/v2/empresas/${encodeURIComponent(focusEmpresaId)}`;
  let focusRes: Response;
  try {
    focusRes = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: basicAuthHeader(focusToken),
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
      },
      body: JSON.stringify(focusBody),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha de rede na Focus.";
    return json({ ok: false, error: msg }, 502);
  }

  let focusParsed: unknown;
  try {
    focusParsed = await focusRes.json();
  } catch {
    focusParsed = null;
  }

  if (!focusRes.ok) {
    const o =
      focusParsed && typeof focusParsed === "object"
        ? (focusParsed as Record<string, unknown>)
        : {};
    const msg =
      (typeof o.codigo === "string" && o.codigo) ||
      (typeof o.mensagem === "string" && o.mensagem) ||
      (typeof o.message === "string" && o.message) ||
      (typeof o.error === "string" && o.error) ||
      `Focus HTTP ${focusRes.status}`;
    return json({ ok: false, error: msg, focus_status: focusRes.status }, 502);
  }

  return json({
    ok: true,
    data: focusParsed ?? {},
    focus_empresa_id: focusEmpresaId,
  });
});

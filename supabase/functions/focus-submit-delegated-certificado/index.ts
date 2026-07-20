/**
 * Envio público de certificado A1 via link one-time do onboarding fiscal.
 * Valida token, integra com Focus e atualiza a unidade.
 */
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
  return `Basic ${btoa(`${token.trim()}:`)}`;
}

function optString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (v == null) return "";
  return String(v).trim();
}

function parseFocusEmpresaId(data: unknown): number | undefined {
  if (!data || typeof data !== "object") return undefined;
  const o = data as Record<string, unknown>;
  const raw = o.id ?? o.id_empresa;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    return parseInt(raw.trim(), 10);
  }
  return undefined;
}

function parseCertValidade(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const o = data as Record<string, unknown>;
  const v =
    o.certificado_valido_ate ??
    o.certificado_validade ??
    o.validade_certificado;
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function buildFocusBodyFromCompany(
  empresa: Record<string, unknown>,
  endereco: Record<string, unknown>,
  certB64: string,
  senha: string,
): Record<string, unknown> {
  const doc = optString(empresa.cnpj_cpf).replace(/\D/g, "").slice(0, 14);
  const cepDigits = optString(endereco.cep).replace(/\D/g, "").slice(0, 8);
  const cepNum = cepDigits ? parseInt(cepDigits, 10) : 0;
  const tel = optString(empresa.telefone).replace(/\D/g, "");
  const ieDigits = optString(empresa.inscricao_estadual).replace(/\D/g, "");
  const ieNum = ieDigits ? parseInt(ieDigits, 10) : 0;
  const numRaw = optString(endereco.numero).replace(/\D/g, "");
  const numeroParsed = numRaw ? parseInt(numRaw, 10) : 0;
  const regime = empresa.regime_tributario;
  const regimeNum =
    regime === 1 || regime === 2 || regime === 3 ? regime : 1;

  return {
    nome: optString(empresa.nome_razao_social),
    nome_fantasia: optString(empresa.nome_fantasia),
    bairro: optString(endereco.bairro),
    cep: cepNum,
    cnpj: doc,
    complemento: optString(endereco.complemento),
    discrimina_impostos: true,
    email: optString(empresa.email) || "contato@faro.ai",
    enviar_email_destinatario: false,
    inscricao_estadual: Number.isFinite(ieNum) ? ieNum : 0,
    inscricao_municipal: 0,
    logradouro: optString(endereco.logradouro),
    numero: Number.isFinite(numeroParsed) ? numeroParsed : 0,
    regime_tributario: regimeNum,
    telefone: tel || "0000000000",
    municipio: optString(endereco.municipio),
    uf: optString(endereco.uf).toUpperCase().slice(0, 2),
    habilita_nfe: false,
    habilita_nfce: false,
    habilita_manifestacao: true,
    arquivo_certificado_base64: certB64,
    senha_certificado: senha,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const focusToken = Deno.env.get("FOCUS_NFE_TOKEN")?.trim();
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "Configuração do servidor incompleta." }, 500);
  }
  if (!focusToken) {
    return json({ ok: false, error: "FOCUS_NFE_TOKEN não configurado." }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400);
  }

  const token = optString(body.token);
  const certB64 = optString(body.arquivo_certificado_base64);
  const senha = optString(body.senha_certificado);
  if (!token) return json({ ok: false, error: "Token inválido." }, 400);
  if (!certB64 || !senha) {
    return json({ ok: false, error: "Informe certificado e senha." }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: pub, error: pubErr } = await admin.rpc(
    "get_setup_certificate_delegation_public",
    { p_token: token },
  );
  if (pubErr || !pub || (pub as { ok?: boolean }).ok !== true) {
    const err =
      pub && typeof pub === "object" && "error" in pub
        ? String((pub as { error?: string }).error)
        : "Link inválido ou inacessível.";
    return json({ ok: false, error: err }, 403);
  }

  const companyId = String((pub as { company_id?: string }).company_id ?? "");
  if (!companyId) {
    return json({ ok: false, error: "Unidade não encontrada." }, 404);
  }

  const { data: company, error: coErr } = await admin
    .from("companies")
    .select("id, empresa, endereco_principal, focusnfe, setup")
    .eq("id", companyId)
    .maybeSingle();
  if (coErr || !company) {
    return json({ ok: false, error: "Unidade não encontrada." }, 404);
  }

  const empresa =
    company.empresa && typeof company.empresa === "object"
      ? (company.empresa as Record<string, unknown>)
      : {};
  const endereco =
    company.endereco_principal && typeof company.endereco_principal === "object"
      ? (company.endereco_principal as Record<string, unknown>)
      : {};
  const focusnfe =
    company.focusnfe && typeof company.focusnfe === "object"
      ? (company.focusnfe as Record<string, unknown>)
      : {};
  const setup =
    company.setup && typeof company.setup === "object"
      ? (company.setup as Record<string, unknown>)
      : {};

  const rawId = focusnfe.id_empresa;
  const focusEmpresaId =
    typeof rawId === "number" && Number.isFinite(rawId)
      ? String(Math.trunc(rawId))
      : typeof rawId === "string" && rawId.trim()
        ? rawId.trim()
        : "";

  let focusParsed: unknown;
  try {
    if (!focusEmpresaId) {
      const focusBody = buildFocusBodyFromCompany(empresa, endereco, certB64, senha);
      const focusRes = await fetch(`${FOCUS_BASE}/v2/empresas`, {
        method: "POST",
        headers: {
          Authorization: basicAuthHeader(focusToken),
          "Content-Type": "application/json; charset=utf-8",
          Accept: "application/json",
        },
        body: JSON.stringify(focusBody),
      });
      focusParsed = await focusRes.json().catch(() => null);
      if (!focusRes.ok) {
        const o =
          focusParsed && typeof focusParsed === "object"
            ? (focusParsed as Record<string, unknown>)
            : {};
        const msg =
          optString(o.mensagem) ||
          optString(o.message) ||
          optString(o.error) ||
          `Focus HTTP ${focusRes.status}`;
        return json({ ok: false, error: msg }, 502);
      }
    } else {
      const focusRes = await fetch(
        `${FOCUS_BASE}/v2/empresas/${encodeURIComponent(focusEmpresaId)}`,
        {
          method: "PUT",
          headers: {
            Authorization: basicAuthHeader(focusToken),
            "Content-Type": "application/json; charset=utf-8",
            Accept: "application/json",
          },
          body: JSON.stringify({
            arquivo_certificado_base64: certB64,
            senha_certificado: senha,
          }),
        },
      );
      focusParsed = await focusRes.json().catch(() => null);
      if (!focusRes.ok) {
        const o =
          focusParsed && typeof focusParsed === "object"
            ? (focusParsed as Record<string, unknown>)
            : {};
        const msg =
          optString(o.mensagem) ||
          optString(o.message) ||
          optString(o.error) ||
          `Focus HTTP ${focusRes.status}`;
        return json({ ok: false, error: msg }, 502);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha de rede na Focus.";
    return json({ ok: false, error: msg }, 502);
  }

  const idEmpresa = parseFocusEmpresaId(focusParsed) ?? parseFocusEmpresaId(focusnfe);
  const certValidade = parseCertValidade(focusParsed);

  const completed = new Set<number>(
    Array.isArray(setup.completed_steps)
      ? (setup.completed_steps as number[])
      : [],
  );
  completed.add(1);
  completed.add(2);

  const nextFocusnfe = {
    ...focusnfe,
    ...(idEmpresa != null ? { id_empresa: idEmpresa } : {}),
    certificado_ativo: true,
    ...(certValidade ? { certificado_validade: certValidade } : {}),
  };
  delete nextFocusnfe.arquivo_certificado_base64;
  delete nextFocusnfe.senha_certificado;

  const nextSetup = {
    ...setup,
    status: "in_progress",
    current_step: Math.max(3, Number(setup.current_step ?? 2)),
    completed_steps: [...completed].sort((a, b) => a - b),
    certificate: {
      ...(typeof setup.certificate === "object" && setup.certificate
        ? setup.certificate
        : {}),
      mode: "upload_now",
      status: "valid",
      updated_at: new Date().toISOString(),
    },
  };

  const { error: upErr } = await admin
    .from("companies")
    .update({
      focusnfe: nextFocusnfe,
      setup: nextSetup,
    })
    .eq("id", companyId);
  if (upErr) {
    return json({ ok: false, error: upErr.message }, 500);
  }

  const { data: mark, error: markErr } = await admin.rpc(
    "mark_setup_certificate_delegation_used",
    { p_token: token },
  );
  if (markErr || !mark || (mark as { ok?: boolean }).ok !== true) {
    return json({ ok: false, error: "Falha ao finalizar o link." }, 500);
  }

  return json({ ok: true });
});

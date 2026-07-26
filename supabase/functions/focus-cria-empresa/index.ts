/**
 * Proxy autenticado para criar empresa na API Focus NFe (produção).
 * @see https://focusnfe.com.br/doc/#empresas
 *
 * POST com JSON contendo os campos da empresa; o corpo enviado à Focus é montado com a estrutura
 * documentada (tipos coerentes: CEP/IE/número/regime numéricos, flags booleanas, CNPJ só dígitos).
 * Parâmetro opcional dry_run: query ?dry_run=1 ou campo top-level "dry_run" (não repassado à Focus).
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
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function optString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") {
    const t = v.trim();
    return t.length ? t : undefined;
  }
  const s = String(v).trim();
  return s.length ? s : undefined;
}

function optNumber(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).replace(/\s/g, "");
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function optBoolean(v: unknown, defaultVal: boolean): boolean {
  if (v === undefined || v === null) return defaultVal;
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1" || v === "true") return true;
  if (v === 0 || v === "0" || v === "false") return false;
  return defaultVal;
}

function normalizeCnpjDigits(v: unknown): string | null {
  const raw = optString(v) ?? (typeof v === "number" ? String(v) : "");
  const digits = String(raw).replace(/\D/g, "");
  return digits.length === 14 ? digits : null;
}

/**
 * Primeiro dia do mês civil **de dois meses atrás** em relação à data de referência,
 * em `America/Sao_Paulo`, formato `dd/MM/yyyy` (Focus: `data_inicio_recebimento_nfe`).
 */
function firstDayOfTwoMonthsAgoFocusBr(reference: Date): string {
  const dtf = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const bits = dtf.formatToParts(reference);
  const n = (t: Intl.DateTimeFormatPart["type"]) =>
    parseInt(bits.find((b) => b.type === t)?.value ?? "", 10);
  const month = n("month");
  const year = n("year");
  if (!Number.isFinite(month) || !Number.isFinite(year)) {
    const y = reference.getUTCFullYear();
    const m = reference.getUTCMonth();
    let targetMIdx = m - 2;
    let targetY = y;
    while (targetMIdx < 0) {
      targetMIdx += 12;
      targetY -= 1;
    }
    return `01/${String(targetMIdx + 1).padStart(2, "0")}/${targetY}`;
  }
  let targetMonth = month - 2;
  let targetYear = year;
  while (targetMonth < 1) {
    targetMonth += 12;
    targetYear -= 1;
  }
  return `01/${String(targetMonth).padStart(2, "0")}/${targetYear}`;
}

/** Senha do certificado: número JSON ou string; strings só dígitos viram número (como no exemplo da Focus). */
function coerceSenhaCertificado(v: unknown): string | number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const t = typeof v === "string" ? v.trim() : String(v).trim();
  if (t.length === 0) return undefined;
  if (/^[0-9]+$/.test(t)) {
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return t;
}

/** Monta o JSON da empresa conforme estrutura esperada pela Focus (campos conhecidos + extras opcionais). */
function buildFocusEmpresaBody(raw: Record<string, unknown>):
  | {
      ok: true;
      body: Record<string, unknown>;
    }
  | { ok: false; error: string } {
  const nome = optString(raw.nome);
  const nomeFantasia = optString(raw.nome_fantasia);
  const bairro = optString(raw.bairro);
  const cep = optNumber(raw.cep);
  const cnpj = normalizeCnpjDigits(raw.cnpj);
  const email = optString(raw.email);
  const logradouro = optString(raw.logradouro);
  const municipio = optString(raw.municipio);
  const uf = optString(raw.uf);
  const telefone =
    optString(raw.telefone) ??
    (typeof raw.telefone === "number" && Number.isFinite(raw.telefone)
      ? String(Math.trunc(raw.telefone))
      : undefined);
  const fallbackEmail =
    cnpj != null
      ? `naoresponder+${cnpj}@faro.local`
      : "naoresponder@faro.local";
  const emailFinal = email ?? fallbackEmail;
  const telefoneFinal = telefone ?? "0000000000";

  const inscricaoEstadual = optNumber(raw.inscricao_estadual);
  const inscricaoMunicipal = optNumber(raw.inscricao_municipal);
  const numero = optNumber(raw.numero);
  const regimeTributario = optNumber(raw.regime_tributario);

  const arquivoCertificadoBase64 =
    typeof raw.arquivo_certificado_base64 === "string" &&
    raw.arquivo_certificado_base64.trim().length > 0
      ? raw.arquivo_certificado_base64.trim()
      : undefined;
  const senhaCertificado = coerceSenhaCertificado(raw.senha_certificado);

  const missing: string[] = [];
  if (!nome) missing.push("nome");
  if (!nomeFantasia) missing.push("nome_fantasia");
  if (!bairro) missing.push("bairro");
  if (cep === undefined) missing.push("cep");
  if (!cnpj) missing.push("cnpj (14 dígitos)");
  // onboarding pode não informar email/telefone; aplicamos fallback para Focus.
  if (inscricaoEstadual === undefined) missing.push("inscricao_estadual");
  if (inscricaoMunicipal === undefined) missing.push("inscricao_municipal");
  if (!logradouro) missing.push("logradouro");
  if (numero === undefined) missing.push("numero");
  if (regimeTributario === undefined) missing.push("regime_tributario");
  if (!municipio) missing.push("municipio");
  if (!uf) missing.push("uf");
  else if (uf.length !== 2) missing.push("uf (2 letras)");
  if (!arquivoCertificadoBase64) missing.push("arquivo_certificado_base64");
  if (senhaCertificado === undefined) missing.push("senha_certificado");

  if (missing.length > 0) {
    return {
      ok: false,
      error: `Campos obrigatórios ausentes ou inválidos: ${missing.join(", ")}.`,
    };
  }

  const ufUpper = uf!.toUpperCase();

  const complemento = optString(raw.complemento) ?? "";
  const enviarEmailDestinatario = false;

  /** Default: 1º dia de dois meses atrás em SP. Override opcional via body. */
  const overrideInicio = optString(raw.data_inicio_recebimento_nfe);
  let dataInicioRecebimentoNfe = firstDayOfTwoMonthsAgoFocusBr(new Date());
  if (overrideInicio) {
    // Aceita dd/MM/yyyy (Focus) ou yyyy-MM-dd.
    const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(overrideInicio);
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(overrideInicio);
    if (br) {
      dataInicioRecebimentoNfe = overrideInicio;
    } else if (iso) {
      dataInicioRecebimentoNfe = `${iso[3]}/${iso[2]}/${iso[1]}`;
    }
  }

  const knownKeys = new Set([
    "dry_run",
    "nome",
    "nome_fantasia",
    "bairro",
    "cep",
    "cnpj",
    "complemento",
    "discrimina_impostos",
    "email",
    "enviar_email_destinatario",
    "inscricao_estadual",
    "inscricao_municipal",
    "logradouro",
    "numero",
    "regime_tributario",
    "telefone",
    "municipio",
    "uf",
    "arquivo_certificado_base64",
    "senha_certificado",
    "data_inicio_recebimento_nfe",
  ]);

  const body: Record<string, unknown> = {
    nome,
    nome_fantasia: nomeFantasia,
    bairro,
    cep,
    cnpj,
    complemento,
    discrimina_impostos: true,
    email: emailFinal,
    enviar_email_destinatario: enviarEmailDestinatario,
    inscricao_estadual: inscricaoEstadual,
    inscricao_municipal: inscricaoMunicipal,
    logradouro,
    numero,
    regime_tributario: regimeTributario,
    telefone: telefoneFinal,
    municipio,
    uf: ufUpper,
    habilita_nfe: false,
    habilita_nfce: false,
    habilita_manifestacao: true,
    data_inicio_recebimento_nfe: dataInicioRecebimentoNfe,
    arquivo_certificado_base64: arquivoCertificadoBase64,
    senha_certificado: senhaCertificado,
  };

  for (const [k, v] of Object.entries(raw)) {
    if (knownKeys.has(k)) continue;
    if (v !== undefined) body[k] = v;
  }

  return { ok: true, body };
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
  const apiBase = (
    Deno.env.get("FOCUS_NFE_API_BASE")?.trim() || "https://api.focusnfe.com.br"
  ).replace(/\/$/, "");

  if (!supabaseUrl || !anonKey) {
    return json(
      { ok: false, error: "Configuração do servidor incompleta." },
      500,
    );
  }
  if (!focusToken) {
    return json(
      {
        ok: false,
        error: "Integração Focus não configurada (FOCUS_NFE_TOKEN).",
      },
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400);
  }

  if (!isPlainObject(body)) {
    return json({ ok: false, error: "O corpo deve ser um objeto JSON." }, 400);
  }

  const url = new URL(req.url);
  const dryRunQuery = url.searchParams.get("dry_run") === "1";
  const dryRunBody =
    body.dry_run === true || body.dry_run === 1 || body.dry_run === "1";
  const dryRun = dryRunQuery || dryRunBody;

  const raw = { ...body };
  delete raw.dry_run;

  const built = buildFocusEmpresaBody(raw);
  if (!built.ok) {
    return json({ ok: false, error: built.error }, 400);
  }
  const focusBody = built.body;

  const focusUrl = `${apiBase}/v2/empresas${dryRun ? "?dry_run=1" : ""}`;
  let focusRes: Response;
  try {
    focusRes = await fetch(focusUrl, {
      method: "POST",
      headers: {
        Authorization: focusBasicAuthHeader(focusToken),
        Accept: "application/json",
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(focusBody),
    });
  } catch (e) {
    console.error("[focus-cria-empresa] fetch Focus:", e);
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
        dry_run: dryRun,
        focus: payload,
      },
      focusRes.status >= 400 && focusRes.status < 600 ? focusRes.status : 502,
    );
  }

  return json({ ok: true, dry_run: dryRun, data: payload });
});

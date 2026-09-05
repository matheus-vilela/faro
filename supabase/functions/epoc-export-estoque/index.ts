/**
 * Exporta relatório EPOC `mod_rel_estoque` → itens de Saída (`#tblExport`).
 * Ferramenta de desenvolvimento: um dia por consulta.
 *
 * POST { company_id, data? }
 * `data` em dd/MM/aaaa. Default: ontem (America/Sao_Paulo).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { userHasCompanyAccess } from "../_shared/companyAccess.ts";
import {
  buildEstoqueSaidaCsv,
  extractEstoqueSaidaFromAcoesHtml,
  MODULO_REL_ESTOQUE,
} from "../_shared/epocEstoqueCsv.ts";
import { fetchEpocPortalPostWithRetry } from "../_shared/epocPortalFetch.ts";
import {
  normalizeEpocBaseUrlInput,
  performEpocPortalLogin,
} from "../_shared/epocPortalLoginSession.ts";
import { humanizeEpocRemoteError } from "../_shared/epocRemoteErrorMessage.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOG = "[epoc-export-estoque]";
const DEFAULT_LOGIN_PATH = "/index.php";
const DEFAULT_NAOMENU = "123A";
const PATH_VALIDADOR_OZ = "/validadorOz.php";
const PATH_ACOES = "/acoes.php";
const TIMEOUT_MS = 180_000;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

function log(phase: string, data: Record<string, unknown> = {}): void {
  console.log(LOG, phase, { ...data, at: new Date().toISOString() });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function trimBaseUrl(base: string): string {
  return base.trim().replace(/\/$/, "");
}

function resolveUrlAgainstBase(baseUrl: string, pathOrUrl: string): string {
  const t = pathOrUrl.trim();
  if (t.startsWith("http://") || t.startsWith("https://")) return t;
  const path = t.startsWith("/") ? t : `/${t}`;
  return `${trimBaseUrl(baseUrl)}${path}`;
}

function collectSetCookieHeader(headers: Headers): string {
  const pairs: string[] = [];
  headers.forEach((val, key) => {
    if (key.toLowerCase() === "set-cookie") {
      const nameValue = val.split(";")[0]?.trim() ?? "";
      if (nameValue) pairs.push(nameValue);
    }
  });
  return pairs.join("; ");
}

function mergeCookieStrings(a: string, b: string): string {
  const m = new Map<string, string>();
  for (const part of [a, b].filter(Boolean).join("; ").split(/;\s*/)) {
    const t = part.trim();
    if (!t) continue;
    const eq = t.indexOf("=");
    if (eq > 0) m.set(t.slice(0, eq), t.slice(eq + 1));
  }
  return [...m.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function headersValidador(
  cookies: string,
  origin: string,
  referer: string,
): Record<string, string> {
  return {
    Cookie: cookies,
    Accept: "text/plain, */*;q=0.01",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    DNT: "1",
    Origin: origin,
    Pragma: "no-cache",
    Referer: referer,
    "User-Agent": BROWSER_UA,
    "X-Requested-With": "XMLHttpRequest",
  };
}

function headersAcoes(
  cookies: string,
  origin: string,
  referer: string,
): Record<string, string> {
  return {
    Cookie: cookies,
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    DNT: "1",
    Origin: origin,
    Pragma: "no-cache",
    Referer: referer,
    "User-Agent": BROWSER_UA,
    "X-Requested-With": "XMLHttpRequest",
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function yesterdayDateBrInTz(tz: string): string {
  const ymdInTz = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  const today = ymdInTz(new Date());
  let probe = new Date(Date.now() - 12 * 60 * 60 * 1000);
  for (let i = 0; i < 48; i++) {
    if (ymdInTz(probe) !== today) {
      const [y, m, d] = ymdInTz(probe).split("-").map((x) => parseInt(x, 10));
      return `${pad2(d)}/${pad2(m)}/${y}`;
    }
    probe = new Date(probe.getTime() - 60 * 60 * 1000);
  }
  const [y0, m0, d0] = today.split("-").map((x) => parseInt(x, 10));
  const fb = new Date(Date.UTC(y0, m0 - 1, d0 - 1));
  return `${pad2(fb.getUTCDate())}/${pad2(fb.getUTCMonth() + 1)}/${fb.getUTCFullYear()}`;
}

function parseBrDate(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const d = parseInt(m[1] ?? "0", 10);
  const mo = parseInt(m[2] ?? "0", 10);
  const y = parseInt(m[3] ?? "0", 10);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Use POST" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ ok: false, error: "Configuração do servidor incompleta" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "Não autenticado" }, 401);
  }

  type Body = {
    company_id?: string;
    data?: string;
  };
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ ok: false, error: "JSON inválido" }, 400);
  }

  const companyId =
    typeof body.company_id === "string" ? body.company_id.trim() : "";
  if (!companyId) {
    return json({ ok: false, error: "company_id é obrigatório" }, 400);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return json({ ok: false, error: "Sessão inválida" }, 401);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  if (!(await userHasCompanyAccess(admin, user.id, companyId))) {
    return json({ ok: false, error: "Sem acesso a esta unidade" }, 403);
  }

  const { data: integ, error: integErr } = await admin
    .from("company_integrations")
    .select("enabled, settings")
    .eq("company_id", companyId)
    .eq("provider", "epoc")
    .maybeSingle();
  if (integErr) {
    return json({ ok: false, error: integErr.message }, 500);
  }
  if (!integ) {
    return json({ ok: false, error: "Integração EPOC não encontrada" }, 404);
  }
  if (!integ.enabled) {
    return json({ ok: false, error: "Integração inativa" }, 400);
  }

  const raw = (integ.settings ?? {}) as Record<string, unknown>;
  const baseUrl = normalizeEpocBaseUrlInput(String(raw.base_url ?? "").trim());
  const username = String(raw.username ?? "");
  const password = String(raw.password ?? "");
  const naoMenu = String(raw.codigo_filial ?? "").trim() || DEFAULT_NAOMENU;
  if (!baseUrl) {
    return json({ ok: false, error: "URL base não configurada" }, 400);
  }
  if (!username || !password) {
    return json(
      { ok: false, error: "Usuário ou senha ausentes em integração" },
      400,
    );
  }

  const dataBr =
    typeof body.data === "string" && body.data.trim()
      ? body.data.trim()
      : yesterdayDateBrInTz("America/Sao_Paulo");
  if (!parseBrDate(dataBr)) {
    return json({ ok: false, error: "Data inválida (use dd/MM/aaaa)." }, 400);
  }

  const loginPath =
    String(raw.portal_login_path ?? "").trim() || DEFAULT_LOGIN_PATH;
  const timeout = AbortSignal.timeout(TIMEOUT_MS);

  log("start", { company_id: companyId, data: dataBr });

  const loginResult = await performEpocPortalLogin({
    normalizedBaseUrl: baseUrl,
    username,
    password,
    loginPath,
    userFieldFromSettings: String(raw.portal_user_field ?? "").trim(),
    passFieldFromSettings: String(raw.portal_pass_field ?? "").trim(),
    hidden: {},
    signal: timeout,
    naoMenu,
    sendToken: raw.send_token !== false,
  });

  if (!loginResult.ok) {
    return json(
      {
        ok: false,
        error: loginResult.message,
        epoc_error_code: loginResult.errorCode,
      },
      502,
    );
  }

  let cookies = loginResult.cookies;
  const token = loginResult.token;
  const origin = loginResult.origin;
  const refererIndex = loginResult.refererIndex;
  const sendToken = raw.send_token !== false;
  const tokenForBody = sendToken ? token : "";

  const validadorOzUrl = resolveUrlAgainstBase(baseUrl, PATH_VALIDADOR_OZ);
  const acoesUrl = resolveUrlAgainstBase(baseUrl, PATH_ACOES);
  const validadorBody = new URLSearchParams({
    NaoMenu: naoMenu,
    token: tokenForBody,
  }).toString();

  async function refreshValidador(phase: string): Promise<void> {
    try {
      const fetched = await fetchEpocPortalPostWithRetry(
        validadorOzUrl,
        {
          method: "POST",
          headers: headersValidador(cookies, origin, refererIndex),
          body: validadorBody,
          redirect: "follow",
          signal: timeout,
        },
        { label: `validador refresh ${phase}`, attempts: 2, baseDelayMs: 400, log },
      );
      const more = collectSetCookieHeader(fetched.response.headers);
      if (more) cookies = mergeCookieStrings(cookies, more);
    } catch (e) {
      log("validador_refresh_falhou", {
        phase,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function postValidador(phase: string): Promise<boolean> {
    try {
      const fetched = await fetchEpocPortalPostWithRetry(
        validadorOzUrl,
        {
          method: "POST",
          headers: headersValidador(cookies, origin, refererIndex),
          body: validadorBody,
          redirect: "follow",
          signal: timeout,
        },
        { label: `validador ${phase}`, log },
      );
      const more = collectSetCookieHeader(fetched.response.headers);
      if (more) cookies = mergeCookieStrings(cookies, more);
      return fetched.response.ok;
    } catch (e) {
      log("validador_falhou", {
        phase,
        message: humanizeEpocRemoteError(
          e instanceof Error ? e.message : String(e),
        ),
      });
      return false;
    }
  }

  async function postAcoes(
    phase: string,
    pairs: Record<string, string>,
  ): Promise<{ ok: boolean; text: string }> {
    const formBody = new URLSearchParams(pairs).toString();
    try {
      const fetched = await fetchEpocPortalPostWithRetry(
        acoesUrl,
        {
          method: "POST",
          headers: headersAcoes(cookies, origin, refererIndex),
          body: formBody,
          redirect: "follow",
          signal: timeout,
        },
        {
          label: `acoes ${phase}`,
          log,
          attempts: 5,
          baseDelayMs: 1200,
          onBeforeRetry: async () => {
            await refreshValidador(phase);
          },
        },
      );
      const more = collectSetCookieHeader(fetched.response.headers);
      if (more) cookies = mergeCookieStrings(cookies, more);
      return { ok: fetched.response.ok, text: fetched.text };
    } catch (e) {
      return {
        ok: false,
        text: humanizeEpocRemoteError(
          e instanceof Error ? e.message : String(e),
        ),
      };
    }
  }

  // Relatório de estoque não devolve ConteudoTela. Fluxo do portal:
  // validadorOz.php (NaoMenu+token) → acoes.php action=FILTRAR.
  if (!(await postValidador("filtro"))) {
    return json({ ok: false, error: "validadorOz.php falhou." }, 502);
  }

  const acoesDia = await postAcoes("filtrar", {
    modulo: MODULO_REL_ESTOQUE,
    NaoMenu: naoMenu,
    action: "FILTRAR",
    token: tokenForBody,
    data_de: dataBr,
    data_ate: dataBr,
    hr_de: "00:00",
    hr_ate: "23:59",
    tipo_relatorio: "N",
    cod_estq: "0",
    entrada: "on",
    saida: "on",
    baixa: "on",
    estorno: "on",
    movimentacao: "on",
    correcao: "on",
    cod_estq_sai: "0",
    cod_estq_entr: "0",
    cod_estq_grup: "",
    cod_estq_item: "0",
    cod_func: "0",
  });
  if (!acoesDia.ok) {
    return json(
      { ok: false, error: acoesDia.text || "acoes.php (FILTRAR) falhou." },
      502,
    );
  }

  const extracted = extractEstoqueSaidaFromAcoesHtml(acoesDia.text, dataBr);
  if (extracted.items.length === 0) {
    return json(
      {
        ok: false,
        error: extracted.message ?? "Nenhuma saída em #tblExport neste dia.",
        data: dataBr,
        items: [],
        total_itens: 0,
        total_custo: 0,
      },
      404,
    );
  }

  const csv = buildEstoqueSaidaCsv(dataBr, extracted.items);
  const fileName = `estoque-saida-${dataBr.replace(/\//g, "-")}.csv`;

  log("ok", {
    company_id: companyId,
    data: dataBr,
    total_itens: extracted.saidaCount,
    other_actions: extracted.otherActionCount,
  });

  return json({
    ok: true,
    data: dataBr,
    file_name: fileName,
    csv,
    items: extracted.items,
    total_itens: extracted.saidaCount,
    total_custo: extracted.totalCusto,
    raw_rows: extracted.rawRowCount,
    group_rows: extracted.groupRowCount,
    other_action_count: extracted.otherActionCount,
  });
});

/**
 * Busca EPOC em lote (máx. 2 dias): faturamento + serviços + produtos em paralelo
 * por dia. Se o faturamento do dia não existir / não tiver Total Geral, o dia é
 * descartado por completo (sem CSV de produtos/serviços desse dia).
 *
 * POST {
 *   company_id: string,
 *   days_iso?: string[],           // yyyy-MM-dd (preferido)
 *   consulta_dias_br?: string[],   // dd/MM/aaaa
 * }
 *
 * Resposta: CSVs consolidados (produtos, faturamento, serviços) prontos para
 * união com outros lotes numa função futura de processamento.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { userHasCompanyAccess } from "../_shared/companyAccess.ts";
import {
  isFaturamentoDayUsable,
  type EpocDayBundleDayResult,
} from "../_shared/epocFetchDayBundle.ts";
import {
  buildFaturamentoConsolidatedCsv,
  extractFaturamentoRowsFromAcoesHtml,
  MODULO_REL_FATURAMENTO,
  type FaturamentoDayExtract,
} from "../_shared/epocFaturamentoCsv.ts";
import { htmlHasId, unwrapAcoesHtml } from "../_shared/epocHtmlExtract.ts";
import { fetchEpocPortalPostWithRetry } from "../_shared/epocPortalFetch.ts";
import {
  normalizeEpocBaseUrlInput,
  performEpocPortalLogin,
} from "../_shared/epocPortalLoginSession.ts";
import { brDateToIso, isoDateToBr } from "../_shared/epocPtBrNumber.ts";
import { humanizeEpocRemoteError } from "../_shared/epocRemoteErrorMessage.ts";
import {
  buildProdutoSinteticoConsolidatedCsv,
  extractProdutoSinteticoRowsFromAcoesHtml,
  MODULO_REL_PRODUTO_SINTETICO,
  type ProdutoSinteticoDayExtract,
} from "../_shared/epocProdutoSinteticoCsv.ts";
import {
  buildVendaServicosConsolidatedCsv,
  extractVendaServicosRowsFromAcoesHtml,
  MODULO_REL_VENDA_SERVICOS,
  type VendaServicosDayExtract,
} from "../_shared/epocVendaServicosCsv.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOG = "[epoc-fetch-day-bundle]";
const DEFAULT_LOGIN_PATH = "/index.php";
const DEFAULT_NAOMENU = "123A";
const PATH_VALIDADOR_OZ = "/validadorOz.php";
const PATH_ACOES = "/acoes.php";
const EPOC_ID_CONTEUDO_TELA = "ConteudoTela";
const TIMEOUT_MS = 180_000;
const MAX_DAYS = 2;

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
  refererValidador: string,
): Record<string, string> {
  return {
    Cookie: cookies,
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    Origin: origin,
    Pragma: "no-cache",
    Referer: refererValidador,
    "User-Agent": BROWSER_UA,
    "X-Requested-With": "XMLHttpRequest",
  };
}

function parseBrDate(br: string): boolean {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(br.trim()) && brDateToIso(br.trim()) != null;
}

function normalizeDaysBr(input: {
  days_iso?: unknown;
  consulta_dias_br?: unknown;
}): string[] | { error: string } {
  const out: string[] = [];
  const seen = new Set<string>();

  if (Array.isArray(input.days_iso)) {
    for (const x of input.days_iso) {
      if (typeof x !== "string") continue;
      const iso = x.trim().slice(0, 10);
      const br = isoDateToBr(iso);
      if (!br) continue;
      if (seen.has(br)) continue;
      seen.add(br);
      out.push(br);
      if (out.length >= MAX_DAYS) break;
    }
  }

  if (out.length === 0 && Array.isArray(input.consulta_dias_br)) {
    for (const x of input.consulta_dias_br) {
      if (typeof x !== "string") continue;
      const br = x.trim();
      if (!parseBrDate(br)) continue;
      if (seen.has(br)) continue;
      seen.add(br);
      out.push(br);
      if (out.length >= MAX_DAYS) break;
    }
  }

  if (out.length === 0) {
    return {
      error:
        "Informe days_iso (yyyy-MM-dd) ou consulta_dias_br (dd/MM/aaaa); máx. 2 dias.",
    };
  }
  return out;
}

type AcoesResult = { ok: boolean; text: string; setCookie: string };

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

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ ok: false, error: "Não autenticado" }, 401);
  }
  const bearer = authHeader.slice("Bearer ".length).trim();
  const isServiceInvoke = bearer.length > 0 && bearer === serviceKey.trim();

  type Body = {
    company_id?: string;
    days_iso?: unknown;
    consulta_dias_br?: unknown;
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

  const daysNorm = normalizeDaysBr(body);
  if ("error" in daysNorm) {
    return json({ ok: false, error: daysNorm.error }, 400);
  }
  const diasConsulta = daysNorm;

  const admin = createClient(supabaseUrl, serviceKey);

  if (!isServiceInvoke) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) {
      return json({ ok: false, error: "Sessão inválida" }, 401);
    }
    if (!(await userHasCompanyAccess(admin, user.id, companyId))) {
      return json({ ok: false, error: "Sem acesso a esta unidade" }, 403);
    }
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

  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  log("start", {
    company_id: companyId,
    dias: diasConsulta,
  });

  const loginResult = await performEpocPortalLogin({
    normalizedBaseUrl: baseUrl,
    username,
    password,
    loginPath: String(raw.portal_login_path ?? "").trim() || DEFAULT_LOGIN_PATH,
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
  const tokenForBody = raw.send_token === false ? "" : loginResult.token;
  const origin = loginResult.origin;
  const refererIndex = loginResult.refererIndex;
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

  /** POST acoes com jar fixo (seguro para Promise.all). */
  async function postAcoesSnapshot(
    phase: string,
    cookieJar: string,
    pairs: Record<string, string>,
  ): Promise<AcoesResult> {
    const formBody = new URLSearchParams(pairs).toString();
    try {
      const fetched = await fetchEpocPortalPostWithRetry(
        acoesUrl,
        {
          method: "POST",
          headers: headersAcoes(cookieJar, origin, validadorOzUrl),
          body: formBody,
          redirect: "follow",
          signal: timeout,
        },
        {
          label: `acoes ${phase}`,
          log,
          attempts: 4,
          baseDelayMs: 1000,
          onBeforeRetry: async () => {
            await refreshValidador(phase);
          },
        },
      );
      return {
        ok: fetched.response.ok,
        text: fetched.text,
        setCookie: collectSetCookieHeader(fetched.response.headers),
      };
    } catch (e) {
      return {
        ok: false,
        text: humanizeEpocRemoteError(
          e instanceof Error ? e.message : String(e),
        ),
        setCookie: "",
      };
    }
  }

  async function postAcoesMutating(
    phase: string,
    pairs: Record<string, string>,
  ): Promise<{ ok: boolean; text: string }> {
    const r = await postAcoesSnapshot(phase, cookies, pairs);
    if (r.setCookie) cookies = mergeCookieStrings(cookies, r.setCookie);
    return { ok: r.ok, text: r.text };
  }

  const fase1Modules = [
    { key: "faturamento", modulo: MODULO_REL_FATURAMENTO },
    { key: "servicos", modulo: MODULO_REL_VENDA_SERVICOS },
    { key: "produtos", modulo: MODULO_REL_PRODUTO_SINTETICO },
  ] as const;

  for (const mod of fase1Modules) {
    if (!(await postValidador(`fase1_${mod.key}`))) {
      return json(
        { ok: false, error: `validadorOz fase1 (${mod.key}) falhou.` },
        502,
      );
    }
    const acoes1 = await postAcoesMutating(`fase1_${mod.key}`, {
      modulo: mod.modulo,
      NaoMenu: naoMenu,
      action: "",
      codForm: "",
      pagina: "",
      origem: "",
      viaPix: "",
      arquivoUpload: "",
      token: tokenForBody,
    });
    if (!acoes1.ok) {
      return json(
        { ok: false, error: `acoes.php fase1 (${mod.key}) falhou.` },
        502,
      );
    }
    if (!htmlHasId(unwrapAcoesHtml(acoes1.text), EPOC_ID_CONTEUDO_TELA)) {
      log("fase1_sem_conteudo_tela", { modulo: mod.key });
      // Continua: alguns tenants carregam o módulo só na fase 2.
    }
  }

  const dayResults: EpocDayBundleDayResult[] = [];
  const fatExtracts: FaturamentoDayExtract[] = [];
  const servExtracts: VendaServicosDayExtract[] = [];
  const prodExtracts: ProdutoSinteticoDayExtract[] = [];

  for (let i = 0; i < diasConsulta.length; i++) {
    const diaBr = diasConsulta[i]!;
    const diaIso = brDateToIso(diaBr);
    const suffix = `dia${String(i + 1).padStart(2, "0")}`;

    if (!(await postValidador(`fase2_${suffix}`))) {
      dayResults.push({
        date_br: diaBr,
        date_iso: diaIso,
        status: "error",
        message: "validadorOz falhou neste dia.",
      });
      continue;
    }

    const cookieSnap = cookies;
    const [fatRes, servRes, prodRes] = await Promise.all([
      postAcoesSnapshot(`fase2_${suffix}_fat`, cookieSnap, {
        modulo: MODULO_REL_FATURAMENTO,
        NaoMenu: naoMenu,
        token: tokenForBody,
        data_de: diaBr,
        data_ate: diaBr,
        busca_grupo_evento: "-1",
        filtrar: "FORM",
      }),
      postAcoesSnapshot(`fase2_${suffix}_serv`, cookieSnap, {
        modulo: MODULO_REL_VENDA_SERVICOS,
        NaoMenu: naoMenu,
        action: "FORM",
        token: tokenForBody,
        data_de: diaBr,
        data_ate: diaBr,
        filtrar: "FORM",
      }),
      postAcoesSnapshot(`fase2_${suffix}_prod`, cookieSnap, {
        modulo: MODULO_REL_PRODUTO_SINTETICO,
        NaoMenu: naoMenu,
        token: tokenForBody,
        data_de: diaBr,
        data_ate: diaBr,
        busca_grupo_evento: "-1",
        filtrar: "FORM",
      }),
    ]);

    for (const r of [fatRes, servRes, prodRes]) {
      if (r.setCookie) cookies = mergeCookieStrings(cookies, r.setCookie);
    }

    if (!fatRes.ok) {
      dayResults.push({
        date_br: diaBr,
        date_iso: diaIso,
        status: "error",
        message: `acoes faturamento falhou: ${fatRes.text.slice(0, 200)}`,
      });
      continue;
    }

    const fatExtract = extractFaturamentoRowsFromAcoesHtml(fatRes.text, diaBr);
    if (!isFaturamentoDayUsable(fatExtract)) {
      dayResults.push({
        date_br: diaBr,
        date_iso: diaIso,
        status: "skipped_no_faturamento",
        message:
          fatExtract.message ??
          "Sem faturamento (Total Geral) — dia cancelado (sem produtos/serviços).",
        faturamento_rows: fatExtract.rowCount,
      });
      log("dia_skip_sem_faturamento", { dia: diaBr, message: fatExtract.message });
      continue;
    }

    // Produtos/serviços podem não existir mesmo com faturamento — extract vazio é ok.
    const servExtract = servRes.ok
      ? extractVendaServicosRowsFromAcoesHtml(servRes.text, diaBr)
      : {
          dataConsulta: diaBr,
          itensCount: 0,
          resumoCount: 0,
          rows: [],
          maxCols: 0,
          message: servRes.ok
            ? undefined
            : `acoes serviços falhou: ${servRes.text.slice(0, 160)}`,
        };

    const prodExtract = prodRes.ok
      ? extractProdutoSinteticoRowsFromAcoesHtml(prodRes.text, diaBr)
      : {
          dataConsulta: diaBr,
          rowCount: 0,
          rawRowCount: 0,
          rows: [],
          header: [],
          maxCols: 0,
          message: `acoes produtos falhou: ${prodRes.text.slice(0, 160)}`,
        };

    fatExtracts.push(fatExtract);
    servExtracts.push(servExtract);
    prodExtracts.push(prodExtract);

    dayResults.push({
      date_br: diaBr,
      date_iso: diaIso,
      status: "ok",
      faturamento_rows: fatExtract.rowCount,
      servicos_rows: servExtract.itensCount,
      produtos_rows: prodExtract.rowCount,
      message:
        [
          !servRes.ok ? servExtract.message : null,
          !prodRes.ok ? prodExtract.message : null,
          servRes.ok && servExtract.itensCount === 0
            ? "serviços sem linhas"
            : null,
          prodRes.ok && prodExtract.rowCount === 0
            ? "produtos sem linhas"
            : null,
        ]
          .filter(Boolean)
          .join("; ") || undefined,
    });
  }

  const fatCsv = buildFaturamentoConsolidatedCsv(fatExtracts);
  const servCsv = buildVendaServicosConsolidatedCsv(servExtracts);
  const prodCsv = buildProdutoSinteticoConsolidatedCsv(prodExtracts);

  const okDays = dayResults.filter((d) => d.status === "ok").length;
  const skipped = dayResults.filter(
    (d) => d.status === "skipped_no_faturamento",
  ).length;

  log("done", {
    company_id: companyId,
    ok_days: okDays,
    skipped_no_faturamento: skipped,
    fat_rows: fatCsv.totalRows,
    serv_rows: servCsv.totalRows,
    prod_rows: prodCsv.totalRows,
  });

  return json({
    ok: true,
    company_id: companyId,
    max_days: MAX_DAYS,
    days_requested: diasConsulta,
    days: dayResults,
    csv: {
      produtos: prodCsv.csv,
      faturamento: fatCsv.csv,
      servicos: servCsv.csv,
    },
    stats: {
      dias_ok: okDays,
      dias_skipped_no_faturamento: skipped,
      dias_erro: dayResults.filter((d) => d.status === "error").length,
      produtos_rows: prodCsv.totalRows,
      faturamento_rows: fatCsv.totalRows,
      servicos_rows: servCsv.totalRows,
      produtos_dias_com_dados: prodCsv.diasComDados,
      faturamento_dias_com_dados: fatCsv.diasComDados,
      servicos_dias_com_dados: servCsv.diasComDados,
    },
  });
});

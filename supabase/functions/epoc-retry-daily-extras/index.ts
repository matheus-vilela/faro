/**
 * Rebusca serviços e/ou faturamento EPOC nos dias em falta (`epoc_sync_day_status`).
 * POST { company_id, kinds?: ["services"|"faturamento"], days_iso?: string[] }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { userHasCompanyAccess } from "../_shared/companyAccess.ts";
import { MODULO_REL_FATURAMENTO } from "../_shared/epocFaturamentoCsv.ts";
import { fetchEpocPortalPostWithRetry } from "../_shared/epocPortalFetch.ts";
import {
  normalizeEpocBaseUrlInput,
  performEpocPortalLogin,
} from "../_shared/epocPortalLoginSession.ts";
import {
  buildPartialSyncSummary,
  listEpocSyncGaps,
  persistFaturamentoFromAcoesHtml,
  persistServicesFromAcoesHtml,
} from "../_shared/epocPersistDailyExtras.ts";
import { isoDateToBr } from "../_shared/epocPtBrNumber.ts";
import { humanizeEpocRemoteError } from "../_shared/epocRemoteErrorMessage.ts";
import { triggerEpocDailyExtrasInBackground } from "../_shared/triggerEpocDailyExtras.ts";
import { MODULO_REL_VENDA_SERVICOS } from "../_shared/epocVendaServicosCsv.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOG = "[epoc-retry-daily-extras]";
const DEFAULT_LOGIN_PATH = "/index.php";
const DEFAULT_NAOMENU = "123A";
const PATH_VALIDADOR_OZ = "/validadorOz.php";
const PATH_ACOES = "/acoes.php";
const TIMEOUT_MS = 180_000;
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function log(phase: string, data: Record<string, unknown> = {}): void {
  console.log(LOG, phase, { ...data, at: new Date().toISOString() });
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

function headersPortal(
  cookies: string,
  origin: string,
  referer: string,
  accept: string,
): Record<string, string> {
  return {
    Cookie: cookies,
    Accept: accept,
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
    return json({ ok: false, error: "Configuração incompleta" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "Não autenticado" }, 401);
  }

  type Body = {
    company_id?: string;
    kinds?: unknown;
    days_iso?: unknown;
    max_days?: unknown;
    continue_chain?: unknown;
    chain_attempt?: unknown;
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

  const kindsRaw = Array.isArray(body.kinds) ? body.kinds : ["services", "faturamento"];
  const wantServices = kindsRaw.includes("services");
  const wantFat = kindsRaw.includes("faturamento");
  if (!wantServices && !wantFat) {
    return json({ ok: false, error: "kinds inválido" }, 400);
  }

  const maxDaysRaw = typeof body.max_days === "number" ? body.max_days : 3;
  const maxDays = Math.min(8, Math.max(1, Math.floor(maxDaysRaw)));
  const continueChain = body.continue_chain !== false;
  const chainAttemptRaw =
    typeof body.chain_attempt === "number" ? body.chain_attempt : 0;
  const chainAttempt = Math.max(
    0,
    Math.min(80, Math.floor(chainAttemptRaw)),
  );

  const bearer = authHeader.slice("Bearer ".length).trim();
  const isServiceInvoke = bearer.length > 0 && bearer === serviceKey.trim();

  if (!isServiceInvoke) {
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return json({ ok: false, error: "Sessão inválida" }, 401);

    const adminGate = createClient(supabaseUrl, serviceKey);
    if (!(await userHasCompanyAccess(adminGate, user.id, companyId))) {
      return json({ ok: false, error: "Sem acesso" }, 403);
    }
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const gaps = await listEpocSyncGaps(admin, companyId);
  let daysServices = wantServices ? gaps.services : [];
  let daysFat = wantFat ? gaps.faturamento : [];

  if (Array.isArray(body.days_iso)) {
    const filter = body.days_iso
      .filter((d): d is string => typeof d === "string")
      .map((d) => d.trim())
      .filter(Boolean)
      .slice(0, 62);
    if (filter.length > 0) {
      const set = new Set(filter);
      daysServices = daysServices.filter((d) => set.has(d));
      daysFat = daysFat.filter((d) => set.has(d));
    }
  }

  // Processa poucos dias por invocação para caber no idle timeout de 150s.
  const days = [...new Set([...daysServices, ...daysFat])].slice(0, maxDays);
  if (days.length === 0) {
    return json({
      ok: true,
      message: "Nenhum dia em falta para rebuscar.",
      retried: 0,
      remaining: buildPartialSyncSummary(await listEpocSyncGaps(admin, companyId)),
    });
  }

  const { data: integ, error: integErr } = await admin
    .from("company_integrations")
    .select("enabled, settings")
    .eq("company_id", companyId)
    .eq("provider", "epoc")
    .maybeSingle();
  if (integErr || !integ?.enabled) {
    return json(
      { ok: false, error: integErr?.message ?? "Integração EPOC inativa" },
      400,
    );
  }

  const raw = (integ.settings ?? {}) as Record<string, unknown>;
  const baseUrl = normalizeEpocBaseUrlInput(String(raw.base_url ?? "").trim());
  const username = String(raw.username ?? "");
  const password = String(raw.password ?? "");
  const naoMenu = String(raw.codigo_filial ?? "").trim() || DEFAULT_NAOMENU;
  if (!baseUrl || !username || !password) {
    return json({ ok: false, error: "Credenciais EPOC incompletas" }, 400);
  }

  const timeout = AbortSignal.timeout(TIMEOUT_MS);
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
    return json({ ok: false, error: loginResult.message }, 502);
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

  async function postValidador(): Promise<boolean> {
    try {
      const fetched = await fetchEpocPortalPostWithRetry(
        validadorOzUrl,
        {
          method: "POST",
          headers: headersPortal(
            cookies,
            origin,
            refererIndex,
            "text/plain, */*;q=0.01",
          ),
          body: validadorBody,
          redirect: "follow",
          signal: timeout,
        },
        { log, label: "validador retry" },
      );
      const more = collectSetCookieHeader(fetched.response.headers);
      if (more) cookies = mergeCookieStrings(cookies, more);
      return fetched.response.ok;
    } catch (e) {
      log("validador_fail", {
        message: humanizeEpocRemoteError(
          e instanceof Error ? e.message : String(e),
        ),
      });
      return false;
    }
  }

  async function postAcoes(
    pairs: Record<string, string>,
  ): Promise<{ ok: boolean; text: string }> {
    try {
      const fetched = await fetchEpocPortalPostWithRetry(
        acoesUrl,
        {
          method: "POST",
          headers: headersPortal(
            cookies,
            origin,
            refererIndex,
            "application/json, text/javascript, */*; q=0.01",
          ),
          body: new URLSearchParams(pairs).toString(),
          redirect: "follow",
          signal: timeout,
        },
        { log, label: "acoes retry", attempts: 4, baseDelayMs: 1000 },
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

  // Pré-carga dos módulos (mesma sequência do sync principal).
  for (const modulo of [MODULO_REL_VENDA_SERVICOS, MODULO_REL_FATURAMENTO]) {
    await postValidador();
    await postAcoes({
      modulo,
      NaoMenu: naoMenu,
      action: "",
      codForm: "",
      pagina: "",
      origem: "",
      viaPix: "",
      arquivoUpload: "",
      token: tokenForBody,
    });
  }

  let okCount = 0;
  const details: Record<string, unknown>[] = [];

  for (const dayIso of days) {
    const diaBr = isoDateToBr(dayIso);
    if (!diaBr) continue;
    const dayDetail: Record<string, unknown> = { day: dayIso };

    if (wantServices && daysServices.includes(dayIso)) {
      if (await postValidador()) {
        const a = await postAcoes({
          modulo: MODULO_REL_VENDA_SERVICOS,
          NaoMenu: naoMenu,
          action: "FORM",
          token: tokenForBody,
          data_de: diaBr,
          data_ate: diaBr,
          filtrar: "FORM",
        });
        if (a.ok) {
          const p = await persistServicesFromAcoesHtml(
            admin,
            companyId,
            diaBr,
            a.text,
          );
          dayDetail.services = p;
          if (p.ok) okCount += 1;
        } else {
          dayDetail.services = { ok: false, error: "acoes serviços falhou" };
        }
      } else {
        dayDetail.services = { ok: false, error: "validador falhou" };
      }
    }

    if (wantFat && daysFat.includes(dayIso)) {
      if (await postValidador()) {
        const a = await postAcoes({
          modulo: MODULO_REL_FATURAMENTO,
          NaoMenu: naoMenu,
          token: tokenForBody,
          data_de: diaBr,
          data_ate: diaBr,
          busca_grupo_evento: "-1",
          filtrar: "FORM",
        });
        if (a.ok) {
          const p = await persistFaturamentoFromAcoesHtml(
            admin,
            companyId,
            diaBr,
            a.text,
          );
          dayDetail.faturamento = p;
          if (p.ok) okCount += 1;
        } else {
          dayDetail.faturamento = {
            ok: false,
            error: "acoes faturamento falhou",
          };
        }
      } else {
        dayDetail.faturamento = { ok: false, error: "validador falhou" };
      }
    }

    details.push(dayDetail);
  }

  const remainingGaps = await listEpocSyncGaps(admin, companyId);
  const summary = buildPartialSyncSummary(remainingGaps);
  const nowIso = new Date().toISOString();
  await admin
    .from("company_integrations")
    .update({
      settings: {
        ...raw,
        epoc_partial_sync_summary: summary,
        epoc_partial_sync_missing_services_days: remainingGaps.services,
        epoc_partial_sync_missing_faturamento_days: remainingGaps.faturamento,
        epoc_partial_sync_at: nowIso,
      },
      updated_at: nowIso,
    })
    .eq("company_id", companyId)
    .eq("provider", "epoc");

  const stillMissing =
    remainingGaps.services.length + remainingGaps.faturamento.length;
  // Encadeia enquanto houver gaps. Se okCount=0 (falha transitória no portal),
  // ainda tenta algumas vezes — antes parava na 1.ª falha e o card ficava em 51 dias.
  const maxFailChains = 6;
  const shouldChain =
    continueChain &&
    stillMissing > 0 &&
    (okCount > 0 || chainAttempt < maxFailChains) &&
    chainAttempt < 60;
  if (shouldChain) {
    triggerEpocDailyExtrasInBackground({
      supabaseUrl,
      serviceKey,
      companyId,
      continueChain: true,
      maxDays,
      chainAttempt: chainAttempt + 1,
      logTag: LOG,
    });
    log("chain_next", {
      company_id: companyId,
      chain_attempt: chainAttempt + 1,
      ok_count: okCount,
      remaining_services: remainingGaps.services.length,
      remaining_faturamento: remainingGaps.faturamento.length,
    });
  }

  log("done", { company_id: companyId, days: days.length, okCount });

  return json({
    ok: true,
    retried_days: days.length,
    ok_ops: okCount,
    details,
    partial_sync_summary: summary,
    remaining: remainingGaps,
    chained: shouldChain,
    chain_attempt: chainAttempt,
  });
});

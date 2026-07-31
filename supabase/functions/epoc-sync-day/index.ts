/**
 * EPOC sync-day: produtos + serviços + faturamento em paralelo por dia.
 *
 * - Sem faturamento utilizável (Total Geral) → dia saltado (sem produtos/serviços).
 * - Janelas longas: processa `max_days` (default 2) por invocação e auto-chama-se
 *   (`continue_chain`) até cobrir todo o período — evita idle timeout ~150s.
 * - CSVs parciais no Storage; no fim faz merge, persiste extras e enfileira import
 *   de produtos.
 *
 * POST {
 *   company_id, data_de?, data_ate?, days_iso?, consulta_dias_br?,
 *   sync_mode?: "previous_day",
 *   max_days?: number,
 *   continue_chain?, chain_attempt?, sync_run_id?, steps_prefix?, …,
 *   status_poll?: true  // só lê estado da cadeia (sem portal)
 * }
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
import {
  buildPartialSyncSummary,
  listEpocSyncGaps,
  persistFaturamentoFromAcoesHtml,
  persistServicesFromAcoesHtml,
  upsertEpocSyncDayStatus,
} from "../_shared/epocPersistDailyExtras.ts";
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
import { enqueueAndTriggerEpocCsvImport } from "../_shared/enqueueEpocCsvRevenueImportJob.ts";
import {
  triggerEpocSyncDayContinueInBackground,
  type EpocSyncDayContinuePayload,
} from "../_shared/triggerEpocSyncDayContinue.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOG = "[epoc-sync-day]";
const DEFAULT_LOGIN_PATH = "/index.php";
const DEFAULT_NAOMENU = "123A";
const PATH_VALIDADOR_OZ = "/validadorOz.php";
const PATH_ACOES = "/acoes.php";
const EPOC_ID_CONTEUDO_TELA = "ConteudoTela";
const TIMEOUT_MS = 180_000;
/** Dias por invocação (3 fetches paralelos/dia — manter baixo). */
const DEFAULT_MAX_DAYS_PER_INVOKE = 2;
const MAX_DAYS_PER_INVOKE_CAP = 3;
const MAX_RANGE_DAYS = 93;
const MAX_CHAIN_ATTEMPTS = 80;
const CHAIN_SETTINGS_KEY = "epoc_day_sync_chain";
const STORAGE_BUCKET = "company-setup";
/**
 * O bucket `company-setup` não inclui `text/csv` em allowed_mime_types
 * (só octet-stream, zip, xlsx, pkcs12…). Usar octet-stream nos CSV.
 */
const STORAGE_CSV_CONTENT_TYPE = "application/octet-stream";
const STORAGE_JSON_CONTENT_TYPE = "application/octet-stream";

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

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBrDate(br: string): boolean {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(br.trim()) &&
    brDateToIso(br.trim()) != null;
}

function yesterdayDateBrSaoPaulo(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  const todayIso = `${y}-${m}-${d}`;
  const ms = Date.parse(`${todayIso}T12:00:00-03:00`) - 86_400_000;
  const yParts = fmt.formatToParts(new Date(ms));
  const yy = yParts.find((p) => p.type === "year")?.value ?? "1970";
  const mm = yParts.find((p) => p.type === "month")?.value ?? "01";
  const dd = yParts.find((p) => p.type === "day")?.value ?? "01";
  return `${dd}/${mm}/${yy}`;
}

/** Expande data_de..data_ate (ISO) em dd/MM/aaaa ordenado. */
function enumerateDaysBrFromIsoRange(
  dataDe: string,
  dataAte: string,
): string[] | { error: string } {
  const a = dataDe.trim().slice(0, 10);
  const b = dataAte.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) {
    return { error: "data_de/data_ate inválidos (use yyyy-MM-dd)." };
  }
  if (a > b) return { error: "data_de não pode ser posterior a data_ate." };
  const out: string[] = [];
  let cur = a;
  while (cur <= b) {
    const br = isoDateToBr(cur);
    if (!br) break;
    out.push(br);
    if (out.length > MAX_RANGE_DAYS) {
      return { error: `Período máximo: ${MAX_RANGE_DAYS} dias.` };
    }
    const ms = Date.parse(`${cur}T12:00:00Z`) + 86_400_000;
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    cur = `${y}-${m}-${day}`;
  }
  if (out.length === 0) return { error: "Nenhum dia no intervalo." };
  return out;
}

function mergeCsvPartTexts(parts: string[]): string {
  const nonEmpty = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  if (nonEmpty.length === 0) return "";
  let out = nonEmpty[0]!;
  for (let i = 1; i < nonEmpty.length; i++) {
    const lines = nonEmpty[i]!.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length <= 1) continue;
    out = `${out.replace(/\s+$/, "")}\n${lines.slice(1).join("\n")}`;
  }
  return out.endsWith("\n") ? out : `${out}\n`;
}

type DaySyncChainState = {
  run_id: string;
  status: "fetching" | "done" | "failed";
  steps_prefix: string;
  dias_planned_br: string[];
  dias_done_br: string[];
  part_paths_produtos: string[];
  part_paths_servicos: string[];
  part_paths_faturamento: string[];
  /** Detalhes pesados ficam no Storage (não no JSONB settings). */
  day_results_path: string | null;
  persist_path: string | null;
  totals: {
    dias_ok: number;
    dias_skipped_no_faturamento: number;
    dias_erro: number;
    produtos_rows: number;
    faturamento_rows: number;
    servicos_rows: number;
  };
  requested_by: string;
  chain_attempt: number;
  max_days: number;
  csv_import_job_id: string | null;
  final_paths: {
    produtos: string | null;
    faturamento: string | null;
    servicos: string | null;
  };
  updated_at: string;
  last_error: string | null;
  settings_write_error?: string | null;
};

type AcoesResult = { ok: boolean; text: string; setCookie: string };

type DayHtmlBundle = {
  diaBr: string;
  fatHtml: string;
  servHtml: string;
};

async function uploadText(
  admin: ReturnType<typeof createClient>,
  path: string,
  body: string,
  contentType: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const { error } = await admin.storage.from(STORAGE_BUCKET).upload(
    path,
    new TextEncoder().encode(body),
    { upsert: true, contentType },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true, path };
}

async function downloadText(
  admin: ReturnType<typeof createClient>,
  path: string,
): Promise<string | null> {
  const { data, error } = await admin.storage.from(STORAGE_BUCKET).download(path);
  if (error || !data) return null;
  return await data.text();
}

async function listPartPathsFromStorage(
  admin: ReturnType<typeof createClient>,
  prefix: string,
): Promise<{
  produtos: string[];
  servicos: string[];
  faturamento: string[];
}> {
  const partsFolder = `${prefix.replace(/\/$/, "")}/parts`;
  const { data, error } = await admin.storage
    .from(STORAGE_BUCKET)
    .list(partsFolder, {
      limit: 500,
      sortBy: { column: "name", order: "asc" },
    });
  if (error || !data?.length) {
    log("list_parts_vazio", {
      folder: partsFolder,
      error: error?.message ?? null,
      count: data?.length ?? 0,
    });
    return { produtos: [], servicos: [], faturamento: [] };
  }
  const produtos: string[] = [];
  const servicos: string[] = [];
  const faturamento: string[] = [];
  for (const f of data) {
    const name = String(f.name ?? "");
    if (!name.endsWith(".csv")) continue;
    const full = `${partsFolder}/${name}`;
    if (name.startsWith("produtos-")) produtos.push(full);
    else if (name.startsWith("servicos-")) servicos.push(full);
    else if (name.startsWith("faturamento-")) faturamento.push(full);
  }
  produtos.sort();
  servicos.sort();
  faturamento.sort();
  return { produtos, servicos, faturamento };
}

async function writePartIndex(
  admin: ReturnType<typeof createClient>,
  prefix: string,
  parts: {
    produtos: string[];
    servicos: string[];
    faturamento: string[];
  },
): Promise<string | null> {
  const path = `${prefix.replace(/\/$/, "")}/part-index.json`;
  const up = await uploadText(
    admin,
    path,
    JSON.stringify(parts),
    STORAGE_JSON_CONTENT_TYPE,
  );
  return up.ok ? up.path : null;
}

async function loadPartIndex(
  admin: ReturnType<typeof createClient>,
  prefix: string,
): Promise<{
  produtos: string[];
  servicos: string[];
  faturamento: string[];
} | null> {
  const path = `${prefix.replace(/\/$/, "")}/part-index.json`;
  const t = await downloadText(admin, path);
  if (!t) return null;
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    return {
      produtos: asStringArray(j.produtos),
      servicos: asStringArray(j.servicos),
      faturamento: asStringArray(j.faturamento),
    };
  } catch {
    return null;
  }
}

async function resolvePartPaths(
  admin: ReturnType<typeof createClient>,
  prefix: string,
  current: {
    produtos: string[];
    servicos: string[];
    faturamento: string[];
  },
): Promise<{
  produtos: string[];
  servicos: string[];
  faturamento: string[];
}> {
  if (
    current.produtos.length ||
    current.servicos.length ||
    current.faturamento.length
  ) {
    return current;
  }
  const fromIndex = await loadPartIndex(admin, prefix);
  if (
    fromIndex &&
    (fromIndex.produtos.length ||
      fromIndex.servicos.length ||
      fromIndex.faturamento.length)
  ) {
    return fromIndex;
  }
  return await listPartPathsFromStorage(admin, prefix);
}

function emptyTotals(): DaySyncChainState["totals"] {
  return {
    dias_ok: 0,
    dias_skipped_no_faturamento: 0,
    dias_erro: 0,
    produtos_rows: 0,
    faturamento_rows: 0,
    servicos_rows: 0,
  };
}

function totalsFromDayResults(
  results: EpocDayBundleDayResult[],
): DaySyncChainState["totals"] {
  const t = emptyTotals();
  for (const r of results) {
    if (r.status === "skipped_no_faturamento") {
      t.dias_skipped_no_faturamento += 1;
      continue;
    }
    if (r.status === "error") {
      t.dias_erro += 1;
      continue;
    }
    if (r.status === "ok") {
      t.dias_ok += 1;
      t.produtos_rows += Number(r.produtos_rows ?? 0) || 0;
      t.servicos_rows += Number(r.servicos_rows ?? 0) || 0;
      t.faturamento_rows += Number(r.faturamento_rows ?? 0) || 0;
    }
  }
  return t;
}

function parseChainState(raw: unknown): DaySyncChainState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const runId = typeof o.run_id === "string" ? o.run_id.trim() : "";
  if (!runId) return null;
  const totalsRaw =
    o.totals && typeof o.totals === "object" && !Array.isArray(o.totals)
      ? (o.totals as Record<string, unknown>)
      : {};
  const finalRaw =
    o.final_paths && typeof o.final_paths === "object" &&
      !Array.isArray(o.final_paths)
      ? (o.final_paths as Record<string, unknown>)
      : {};
  return {
    run_id: runId,
    status: o.status === "done" || o.status === "failed" || o.status === "fetching"
      ? o.status
      : "fetching",
    steps_prefix: typeof o.steps_prefix === "string" ? o.steps_prefix : "",
    dias_planned_br: asStringArray(o.dias_planned_br),
    dias_done_br: asStringArray(o.dias_done_br),
    part_paths_produtos: asStringArray(o.part_paths_produtos),
    part_paths_servicos: asStringArray(o.part_paths_servicos),
    part_paths_faturamento: asStringArray(o.part_paths_faturamento),
    day_results_path: typeof o.day_results_path === "string"
      ? o.day_results_path
      : null,
    persist_path: typeof o.persist_path === "string" ? o.persist_path : null,
    totals: {
      dias_ok: Number(totalsRaw.dias_ok ?? 0) || 0,
      dias_skipped_no_faturamento:
        Number(totalsRaw.dias_skipped_no_faturamento ?? 0) || 0,
      dias_erro: Number(totalsRaw.dias_erro ?? 0) || 0,
      produtos_rows: Number(totalsRaw.produtos_rows ?? 0) || 0,
      faturamento_rows: Number(totalsRaw.faturamento_rows ?? 0) || 0,
      servicos_rows: Number(totalsRaw.servicos_rows ?? 0) || 0,
    },
    requested_by: typeof o.requested_by === "string"
      ? o.requested_by
      : "00000000-0000-0000-0000-000000000000",
    chain_attempt: Math.max(0, Math.floor(Number(o.chain_attempt ?? 0) || 0)),
    max_days: Math.max(
      1,
      Math.min(
        MAX_DAYS_PER_INVOKE_CAP,
        Math.floor(Number(o.max_days ?? DEFAULT_MAX_DAYS_PER_INVOKE) ||
          DEFAULT_MAX_DAYS_PER_INVOKE),
      ),
    ),
    csv_import_job_id: typeof o.csv_import_job_id === "string"
      ? o.csv_import_job_id
      : null,
    final_paths: {
      produtos: typeof finalRaw.produtos === "string" ? finalRaw.produtos : null,
      faturamento: typeof finalRaw.faturamento === "string"
        ? finalRaw.faturamento
        : null,
      servicos: typeof finalRaw.servicos === "string" ? finalRaw.servicos : null,
    },
    updated_at: typeof o.updated_at === "string"
      ? o.updated_at
      : new Date().toISOString(),
    last_error: typeof o.last_error === "string" ? o.last_error : null,
    settings_write_error: typeof o.settings_write_error === "string"
      ? o.settings_write_error
      : null,
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
    return json({ ok: false, error: "Configuração do servidor incompleta" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ ok: false, error: "Não autenticado" }, 401);
  }
  const bearer = authHeader.slice("Bearer ".length).trim();
  const isServiceInvoke = bearer.length > 0 && bearer === serviceKey.trim();

  type Body = Record<string, unknown>;
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

  const admin = createClient(supabaseUrl, serviceKey);

  let userIdForJob = "00000000-0000-0000-0000-000000000000";
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
    userIdForJob = user.id;
  } else if (typeof body.requested_by === "string" && body.requested_by.trim()) {
    userIdForJob = body.requested_by.trim();
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

  // --- Status poll (UI) ----------------------------------------------------
  if (body.status_poll === true) {
    const stored = parseChainState(raw[CHAIN_SETTINGS_KEY]);
    const runHint =
      typeof body.sync_run_id === "string" ? body.sync_run_id.trim() : "";
    // Também aceita prefixo do último sync (recuperação se settings ficou stale).
    const prefixHint =
      typeof body.steps_prefix === "string" ? body.steps_prefix.trim() : "";
    const lastPrefix =
      typeof raw.last_epoc_day_sync_prefix === "string"
        ? raw.last_epoc_day_sync_prefix
        : "";

    let effective = stored;
    // Não anular o estado só por run_id diferente se o prefixo for o mesmo
    // (UI pode ter um run antigo enquanto o settings já avançou / vice-versa).
    if (
      runHint &&
      stored &&
      stored.run_id !== runHint &&
      prefixHint &&
      stored.steps_prefix &&
      stored.steps_prefix !== prefixHint
    ) {
      effective = null;
    }

    // Recuperação: sync terminou (paths finais no settings raiz) mesmo se a cadeia
    // ficou "fetching" por falha de UPDATE do JSONB enorme.
    const rootFinal = {
      produtos: typeof raw.last_epoc_day_sync_produtos_csv === "string"
        ? raw.last_epoc_day_sync_produtos_csv
        : null,
      faturamento: typeof raw.last_epoc_day_sync_faturamento_csv === "string"
        ? raw.last_epoc_day_sync_faturamento_csv
        : null,
      servicos: typeof raw.last_epoc_day_sync_servicos_csv === "string"
        ? raw.last_epoc_day_sync_servicos_csv
        : null,
    };
    const hasRootFinal = !!(
      rootFinal.produtos || rootFinal.faturamento || rootFinal.servicos
    );

    if (!effective && !hasRootFinal && !prefixHint && !lastPrefix) {
      return json({
        ok: true,
        continuing: false,
        status: "idle",
        message: "sem cadeia ativa",
      });
    }

    const stepsPrefixPoll =
      effective?.steps_prefix ||
      prefixHint ||
      lastPrefix ||
      "";

    // Se o run_id do UI não bate com o stored, ainda assim recupera pelo prefixo.
    if (!effective && stepsPrefixPoll) {
      effective = stored && stored.steps_prefix === stepsPrefixPoll
        ? stored
        : null;
    }

    let finalPaths = effective?.final_paths ?? {
      produtos: null,
      faturamento: null,
      servicos: null,
    };
    const chainFetching = effective?.status === "fetching";
    // CSVs da run anterior (settings raiz) só entram se não houver cadeia a correr.
    if (
      !chainFetching &&
      !finalPaths.produtos &&
      !finalPaths.faturamento &&
      !finalPaths.servicos
    ) {
      finalPaths = { ...rootFinal };
    }

    async function mergePartsPoll(paths: string[]): Promise<string> {
      const texts: string[] = [];
      for (const p of paths) {
        const t = await downloadText(admin, p);
        if (t) texts.push(t);
      }
      return mergeCsvPartTexts(texts);
    }

    /** Se já existir CSV final no prefixo, usa-o. */
    async function discoverFinalInPrefix(prefix: string): Promise<{
      produtos: string | null;
      faturamento: string | null;
      servicos: string | null;
    }> {
      const base = prefix.replace(/\/$/, "");
      const candidates = {
        produtos: `${base}/produtos.csv`,
        faturamento: `${base}/faturamento.csv`,
        servicos: `${base}/servicos.csv`,
      };
      const out = {
        produtos: null as string | null,
        faturamento: null as string | null,
        servicos: null as string | null,
      };
      await Promise.all(
        (Object.keys(candidates) as Array<keyof typeof candidates>).map(
          async (k) => {
            const path = candidates[k];
            const t = await downloadText(admin, path);
            if (t && t.trim()) out[k] = path;
          },
        ),
      );
      return out;
    }

    const partsDone =
      (effective?.dias_done_br.length ?? 0) >=
        (effective?.dias_planned_br.length ?? 1) &&
      (effective?.dias_planned_br.length ?? 0) > 0;
    const uiSaysComplete = body.force_rebuild_csv === true;
    // Nunca marcar done só por existir prefixo ou CSVs da run ANTERIOR
    // enquanto a cadeia actual ainda está a buscar.
    const markedDone =
      !chainFetching &&
      (effective?.status === "done" ||
        partsDone ||
        uiSaysComplete ||
        (!effective && hasRootFinal));

    // 1) Descobrir finais já gravados no prefixo (só se não estiver a correr).
    if (
      !chainFetching &&
      stepsPrefixPoll &&
      !finalPaths.produtos &&
      !finalPaths.faturamento &&
      !finalPaths.servicos
    ) {
      const found = await discoverFinalInPrefix(stepsPrefixPoll);
      finalPaths = { ...finalPaths, ...found };
    }

    // 2) Sem finais → merge parts (index / listagem no Storage).
    if (
      markedDone &&
      stepsPrefixPoll &&
      !finalPaths.produtos &&
      !finalPaths.faturamento &&
      !finalPaths.servicos
    ) {
      const resolved = await resolvePartPaths(admin, stepsPrefixPoll, {
        produtos: effective?.part_paths_produtos ?? [],
        servicos: effective?.part_paths_servicos ?? [],
        faturamento: effective?.part_paths_faturamento ?? [],
      });
      log("poll_parts_resolved", {
        prefix: stepsPrefixPoll,
        produtos: resolved.produtos.length,
        servicos: resolved.servicos.length,
        faturamento: resolved.faturamento.length,
      });

      const prodMerged = await mergePartsPoll(resolved.produtos);
      const servMerged = await mergePartsPoll(resolved.servicos);
      const fatMerged = await mergePartsPoll(resolved.faturamento);

      if (prodMerged.trim()) {
        const path = `${stepsPrefixPoll}/produtos.csv`;
        const up = await uploadText(admin, path, prodMerged, STORAGE_CSV_CONTENT_TYPE);
        if (up.ok) finalPaths.produtos = up.path;
        else log("upload_final_prod_fail", { error: up.error });
      }
      if (servMerged.trim()) {
        const path = `${stepsPrefixPoll}/servicos.csv`;
        const up = await uploadText(admin, path, servMerged, STORAGE_CSV_CONTENT_TYPE);
        if (up.ok) finalPaths.servicos = up.path;
        else log("upload_final_serv_fail", { error: up.error });
      }
      if (fatMerged.trim()) {
        const path = `${stepsPrefixPoll}/faturamento.csv`;
        const up = await uploadText(admin, path, fatMerged, STORAGE_CSV_CONTENT_TYPE);
        if (up.ok) finalPaths.faturamento = up.path;
        else log("upload_final_fat_fail", { error: up.error });
      }
    }

    const [produtos, faturamento, servicos] = chainFetching
      ? [null, null, null]
      : await Promise.all([
        finalPaths.produtos
          ? downloadText(admin, finalPaths.produtos)
          : Promise.resolve(null),
        finalPaths.faturamento
          ? downloadText(admin, finalPaths.faturamento)
          : Promise.resolve(null),
        finalPaths.servicos
          ? downloadText(admin, finalPaths.servicos)
          : Promise.resolve(null),
      ]);

    const csv = {
      produtos: produtos ?? "",
      faturamento: faturamento ?? "",
      servicos: servicos ?? "",
    };
    const hasCsv = !!(
      csv.produtos.trim() || csv.faturamento.trim() || csv.servicos.trim()
    );

    const continuing = chainFetching;

    let dayResults: EpocDayBundleDayResult[] = [];
    const resultsPath = effective?.day_results_path ??
      (stepsPrefixPoll ? `${stepsPrefixPoll}/day-results.json` : null);
    if (resultsPath) {
      const rawResults = await downloadText(admin, resultsPath);
      if (rawResults) {
        try {
          const parsed = JSON.parse(rawResults);
          if (Array.isArray(parsed)) {
            dayResults = parsed as EpocDayBundleDayResult[];
          }
        } catch {
          /* ignore */
        }
      }
    }

    // Progresso live: day-results pode ir à frente de dias_done_br (chunk a meio).
    const daysDoneCommitted = effective?.dias_done_br.length ?? 0;
    const daysDoneLive = Math.max(daysDoneCommitted, dayResults.length);
    const daysPlanned = effective?.dias_planned_br.length ?? 0;
    const liveTotals = dayResults.length > 0
      ? totalsFromDayResults(dayResults)
      : (effective?.totals ?? emptyTotals());

    // Se recuperámos finais, grava status done leve (não bloqueia a resposta).
    if (markedDone && effective && effective.status !== "done" && hasCsv) {
      const repaired: DaySyncChainState = {
        ...effective,
        status: "done",
        final_paths: finalPaths,
        updated_at: new Date().toISOString(),
        last_error: null,
      };
      const next = { ...raw, [CHAIN_SETTINGS_KEY]: repaired };
      if (finalPaths.produtos) {
        next.last_epoc_day_sync_produtos_csv = finalPaths.produtos;
        next.last_epoc_csv_storage_path = finalPaths.produtos;
      }
      if (finalPaths.faturamento) {
        next.last_epoc_day_sync_faturamento_csv = finalPaths.faturamento;
      }
      if (finalPaths.servicos) {
        next.last_epoc_day_sync_servicos_csv = finalPaths.servicos;
      }
      if (stepsPrefixPoll) next.last_epoc_day_sync_prefix = stepsPrefixPoll;
      void admin
        .from("company_integrations")
        .update({ settings: next, updated_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .eq("provider", "epoc");
    }

    return json({
      ok: true,
      continuing,
      status: markedDone ? "done" : (effective?.status ?? "idle"),
      sync_run_id: effective?.run_id ?? runHint ?? null,
      days_done: daysDoneLive,
      days_planned: daysPlanned,
      days_label: daysPlanned
        ? `${daysDoneLive}/${daysPlanned} dias`
        : undefined,
      chain_attempt: effective?.chain_attempt ?? 0,
      totals: liveTotals,
      stats: liveTotals,
      days: dayResults,
      storage_bucket: STORAGE_BUCKET,
      storage_prefix: stepsPrefixPoll || effective?.steps_prefix || null,
      storage_paths: chainFetching
        ? { produtos: null, faturamento: null, servicos: null }
        : finalPaths,
      csv_import_job_id: effective?.csv_import_job_id ??
        (typeof raw.last_epoc_day_sync_job_id === "string"
          ? raw.last_epoc_day_sync_job_id
          : null),
      csv_import_error: effective?.last_error ?? null,
      last_error: effective?.last_error ?? null,
      updated_at: effective?.updated_at ?? null,
      csv: chainFetching
        ? { produtos: "", faturamento: "", servicos: "" }
        : csv,
      has_csv: chainFetching ? false : hasCsv,
      message: continuing
        ? `A sincronizar… ${daysDoneLive}/${daysPlanned} dias`
        : undefined,
    });
  }

  const continueChainReq = body.continue_chain === true;
  const chainAttemptBody = Math.max(
    0,
    Math.floor(Number(body.chain_attempt ?? 0) || 0),
  );
  const maxDaysPerInvoke = Math.max(
    1,
    Math.min(
      MAX_DAYS_PER_INVOKE_CAP,
      Math.floor(
        Number(body.max_days ?? DEFAULT_MAX_DAYS_PER_INVOKE) ||
          DEFAULT_MAX_DAYS_PER_INVOKE,
      ),
    ),
  );

  async function persistChain(
    state: DaySyncChainState,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const next = { ...raw, [CHAIN_SETTINGS_KEY]: state };
    const { error } = await admin
      .from("company_integrations")
      .update({ settings: next, updated_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("provider", "epoc");
    if (error) {
      log("persist_chain_falhou", { message: error.message });
      return { ok: false, error: error.message };
    }
    // Mantém `raw` coerente nas escritas seguintes desta invocação.
    Object.assign(raw, next);
    return { ok: true };
  }

  async function writeDayResultsFile(
    prefix: string,
    results: EpocDayBundleDayResult[],
  ): Promise<string | null> {
    const path = `${prefix}/day-results.json`;
    const up = await uploadText(
      admin,
      path,
      JSON.stringify(results),
      STORAGE_JSON_CONTENT_TYPE,
    );
    return up.ok ? up.path : null;
  }

  async function loadDayResultsFile(
    path: string | null,
  ): Promise<EpocDayBundleDayResult[]> {
    if (!path) return [];
    const t = await downloadText(admin, path);
    if (!t) return [];
    try {
      const parsed = JSON.parse(t);
      return Array.isArray(parsed) ? parsed as EpocDayBundleDayResult[] : [];
    } catch {
      return [];
    }
  }

  // --- Resolve planned days / resume chain ---------------------------------
  let diasPlanned: string[] = [];
  let diasDonePrior: string[] = [];
  let partProd = asStringArray(body.part_paths_produtos);
  let partServ = asStringArray(body.part_paths_servicos);
  let partFat = asStringArray(body.part_paths_faturamento);
  let dayResultsAcc: EpocDayBundleDayResult[] = [];
  let persistAcc: Array<Record<string, unknown>> = [];
  let dayResultsPath: string | null = null;
  let persistPath: string | null = null;
  let totals = emptyTotals();
  let syncRunId =
    typeof body.sync_run_id === "string" && body.sync_run_id.trim()
      ? body.sync_run_id.trim()
      : crypto.randomUUID();
  let stepsPrefix =
    typeof body.steps_prefix === "string" && body.steps_prefix.trim()
      ? body.steps_prefix.trim()
      : `${companyId}/epoc-sync-day/${new Date().toISOString().replace(/[:.]/g, "-")}`;
  let chainAttempt = chainAttemptBody;
  let requestedBy = userIdForJob;

  const storedChain = parseChainState(raw[CHAIN_SETTINGS_KEY]);

  if (continueChainReq) {
    const fromBodyPlanned = asStringArray(body.dias_planned_br);
    const fromBodyDone = asStringArray(body.dias_done_br);
    if (fromBodyPlanned.length > 0) {
      diasPlanned = fromBodyPlanned;
      diasDonePrior = fromBodyDone;
      if (storedChain && storedChain.run_id === syncRunId) {
        dayResultsPath = storedChain.day_results_path;
        persistPath = storedChain.persist_path;
        dayResultsAcc = await loadDayResultsFile(dayResultsPath);
        totals = { ...storedChain.totals };
        if (!partProd.length) partProd = [...storedChain.part_paths_produtos];
        if (!partServ.length) partServ = [...storedChain.part_paths_servicos];
        if (!partFat.length) partFat = [...storedChain.part_paths_faturamento];
      }
    } else if (storedChain && storedChain.run_id === syncRunId) {
      diasPlanned = storedChain.dias_planned_br;
      diasDonePrior = storedChain.dias_done_br;
      partProd = [...storedChain.part_paths_produtos];
      partServ = [...storedChain.part_paths_servicos];
      partFat = [...storedChain.part_paths_faturamento];
      dayResultsPath = storedChain.day_results_path;
      persistPath = storedChain.persist_path;
      dayResultsAcc = await loadDayResultsFile(dayResultsPath);
      totals = { ...storedChain.totals };
      stepsPrefix = storedChain.steps_prefix || stepsPrefix;
      chainAttempt = Math.max(chainAttempt, storedChain.chain_attempt);
      requestedBy = storedChain.requested_by || requestedBy;
    } else if (storedChain?.status === "fetching") {
      syncRunId = storedChain.run_id;
      diasPlanned = storedChain.dias_planned_br;
      diasDonePrior = storedChain.dias_done_br;
      partProd = [...storedChain.part_paths_produtos];
      partServ = [...storedChain.part_paths_servicos];
      partFat = [...storedChain.part_paths_faturamento];
      dayResultsPath = storedChain.day_results_path;
      persistPath = storedChain.persist_path;
      dayResultsAcc = await loadDayResultsFile(dayResultsPath);
      totals = { ...storedChain.totals };
      stepsPrefix = storedChain.steps_prefix || stepsPrefix;
      chainAttempt = storedChain.chain_attempt;
      requestedBy = storedChain.requested_by || requestedBy;
    } else {
      return json(
        { ok: false, error: "continue_chain sem dias_planned_br / estado." },
        400,
      );
    }

    // Recupera índice de parts no Storage se o body/settings vieram vazios.
    const recovered = await resolvePartPaths(admin, stepsPrefix, {
      produtos: partProd,
      servicos: partServ,
      faturamento: partFat,
    });
    partProd = recovered.produtos;
    partServ = recovered.servicos;
    partFat = recovered.faturamento;

    // day-results pode ter dias do lote a meio (bump live) — só mantém committed.
    {
      const doneSetPrior = new Set(diasDonePrior);
      dayResultsAcc = dayResultsAcc.filter((r) => doneSetPrior.has(r.date_br));
      totals = totalsFromDayResults(dayResultsAcc);
    }
  } else {
    // Nova execução: monta período dinâmico.
    const dataDe =
      typeof body.data_de === "string" ? body.data_de.trim().slice(0, 10) : "";
    const dataAte =
      typeof body.data_ate === "string" ? body.data_ate.trim().slice(0, 10) : "";

    if (dataDe && dataAte) {
      const enumed = enumerateDaysBrFromIsoRange(dataDe, dataAte);
      if ("error" in enumed) {
        return json({ ok: false, error: enumed.error }, 400);
      }
      diasPlanned = enumed;
    } else if (Array.isArray(body.days_iso) && body.days_iso.length > 0) {
      const seen = new Set<string>();
      for (const x of body.days_iso) {
        if (typeof x !== "string") continue;
        const br = isoDateToBr(x.trim().slice(0, 10));
        if (!br || seen.has(br)) continue;
        seen.add(br);
        diasPlanned.push(br);
        if (diasPlanned.length >= MAX_RANGE_DAYS) break;
      }
    } else if (
      Array.isArray(body.consulta_dias_br) && body.consulta_dias_br.length > 0
    ) {
      const seen = new Set<string>();
      for (const x of body.consulta_dias_br) {
        if (typeof x !== "string") continue;
        const br = x.trim();
        if (!parseBrDate(br) || seen.has(br)) continue;
        seen.add(br);
        diasPlanned.push(br);
        if (diasPlanned.length >= MAX_RANGE_DAYS) break;
      }
    } else {
      diasPlanned = [yesterdayDateBrSaoPaulo()];
    }

    if (diasPlanned.length === 0) {
      return json({ ok: false, error: "Nenhum dia para consultar." }, 400);
    }

    // Nova run: limpa cadeia anterior.
    dayResultsAcc = [];
    persistAcc = [];
    totals = emptyTotals();
    partProd = [];
    partServ = [];
    partFat = [];
    chainAttempt = 0;

    // Estado fetching imediato (UI vê 0/N) e esconde CSVs da run anterior.
    const bootState: DaySyncChainState = {
      run_id: syncRunId,
      status: "fetching",
      steps_prefix: stepsPrefix,
      dias_planned_br: diasPlanned,
      dias_done_br: [],
      part_paths_produtos: [],
      part_paths_servicos: [],
      part_paths_faturamento: [],
      day_results_path: null,
      persist_path: null,
      totals: emptyTotals(),
      requested_by: requestedBy,
      chain_attempt: 0,
      max_days: maxDaysPerInvoke,
      csv_import_job_id: null,
      final_paths: { produtos: null, faturamento: null, servicos: null },
      updated_at: new Date().toISOString(),
      last_error: null,
    };
    const bootNext: Record<string, unknown> = {
      ...raw,
      [CHAIN_SETTINGS_KEY]: bootState,
      last_epoc_day_sync_prefix: stepsPrefix,
      last_epoc_day_sync_produtos_csv: null,
      last_epoc_day_sync_faturamento_csv: null,
      last_epoc_day_sync_servicos_csv: null,
      last_epoc_day_sync_job_id: null,
    };
    const { error: bootErr } = await admin
      .from("company_integrations")
      .update({ settings: bootNext, updated_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("provider", "epoc");
    if (bootErr) {
      log("boot_chain_falhou", { message: bootErr.message });
      return json({
        ok: false,
        error: `Falha ao iniciar cadeia: ${bootErr.message}`,
      }, 500);
    }
    Object.assign(raw, bootNext);

    // Devolve já à UI (0/N) e processa o 1.º lote em background —
    // assim o poll vê progresso desde o primeiro dia.
    triggerEpocSyncDayContinueInBackground({
      supabaseUrl,
      serviceKey,
      payload: {
        company_id: companyId,
        continue_chain: true,
        chain_attempt: 0,
        max_days: maxDaysPerInvoke,
        sync_run_id: syncRunId,
        steps_prefix: stepsPrefix,
        dias_planned_br: diasPlanned,
        dias_done_br: [],
        part_paths_produtos: [],
        part_paths_servicos: [],
        part_paths_faturamento: [],
        requested_by: requestedBy,
        totals: emptyTotals(),
      },
      logTag: LOG,
    });
    log("boot_chain_ok", {
      sync_run_id: syncRunId,
      days_planned: diasPlanned.length,
      steps_prefix: stepsPrefix,
    });
    return json({
      ok: true,
      continuing: true,
      company_id: companyId,
      source: "epoc-sync-day",
      sync_run_id: syncRunId,
      chain_attempt: 0,
      days_done: 0,
      days_planned: diasPlanned.length,
      days_label: `0/${diasPlanned.length} dias`,
      days: [],
      totals: emptyTotals(),
      stats: emptyTotals(),
      storage_bucket: STORAGE_BUCKET,
      storage_prefix: stepsPrefix,
      message: `Cadeia iniciada — 0/${diasPlanned.length} dias…`,
      status: "fetching",
    });
  }

  const doneSet = new Set(diasDonePrior);
  const diasRestantes = diasPlanned.filter((d) => !doneSet.has(d));
  const diasConsulta = diasRestantes.slice(0, maxDaysPerInvoke);
  const willContinue = diasRestantes.length > diasConsulta.length;

  if (diasConsulta.length === 0) {
    // Nada a fazer — finalizar a partir das partes já gravadas.
    log("nada_restante", { sync_run_id: syncRunId, planned: diasPlanned.length });
  }

  if (chainAttempt >= MAX_CHAIN_ATTEMPTS && willContinue) {
    const failed: DaySyncChainState = {
      run_id: syncRunId,
      status: "failed",
      steps_prefix: stepsPrefix,
      dias_planned_br: diasPlanned,
      dias_done_br: diasDonePrior,
      part_paths_produtos: partProd,
      part_paths_servicos: partServ,
      part_paths_faturamento: partFat,
      day_results_path: dayResultsPath,
      persist_path: persistPath,
      totals,
      requested_by: requestedBy,
      chain_attempt: chainAttempt,
      max_days: maxDaysPerInvoke,
      csv_import_job_id: null,
      final_paths: { produtos: null, faturamento: null, servicos: null },
      updated_at: new Date().toISOString(),
      last_error: `Limite de cadeia (${MAX_CHAIN_ATTEMPTS}) atingido.`,
    };
    await persistChain(failed);
    return json({
      ok: false,
      error: failed.last_error,
      continuing: false,
      sync_run_id: syncRunId,
      days_done: diasDonePrior.length,
      days_planned: diasPlanned.length,
    }, 500);
  }

  const baseUrl = normalizeEpocBaseUrlInput(String(raw.base_url ?? "").trim());
  const username = String(raw.username ?? "");
  const password = String(raw.password ?? "");
  const naoMenu = String(raw.codigo_filial ?? "").trim() || DEFAULT_NAOMENU;
  if (!baseUrl || !username || !password) {
    return json({ ok: false, error: "Credenciais EPOC incompletas" }, 400);
  }

  log("start_chunk", {
    company_id: companyId,
    sync_run_id: syncRunId,
    chain_attempt: chainAttempt,
    chunk_days: diasConsulta,
    remaining: diasRestantes.length,
    will_continue: willContinue,
  });

  // --- Portal (só se há dias neste lote) ------------------------------------
  const fatExtracts: FaturamentoDayExtract[] = [];
  const servExtracts: VendaServicosDayExtract[] = [];
  const prodExtracts: ProdutoSinteticoDayExtract[] = [];
  const dayHtmlBundles: DayHtmlBundle[] = [];
  const chunkDayResults: EpocDayBundleDayResult[] = [];

  /** Atualiza day-results + totals no settings para a UI fazer poll live. */
  async function bumpLiveProgress(): Promise<void> {
    const liveResults = [...dayResultsAcc, ...chunkDayResults];
    totals = totalsFromDayResults(liveResults);
    dayResultsPath =
      (await writeDayResultsFile(stepsPrefix, liveResults)) ?? dayResultsPath;
    await persistChain({
      run_id: syncRunId,
      status: "fetching",
      steps_prefix: stepsPrefix,
      dias_planned_br: diasPlanned,
      dias_done_br: diasDonePrior,
      part_paths_produtos: partProd,
      part_paths_servicos: partServ,
      part_paths_faturamento: partFat,
      day_results_path: dayResultsPath,
      persist_path: persistPath,
      totals: { ...totals },
      requested_by: requestedBy,
      chain_attempt: chainAttempt,
      max_days: maxDaysPerInvoke,
      csv_import_job_id: null,
      final_paths: { produtos: null, faturamento: null, servicos: null },
      updated_at: new Date().toISOString(),
      last_error: null,
    });
  }

  if (diasConsulta.length > 0) {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const loginResult = await performEpocPortalLogin({
      normalizedBaseUrl: baseUrl,
      username,
      password,
      loginPath:
        String(raw.portal_login_path ?? "").trim() || DEFAULT_LOGIN_PATH,
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
          continuing: false,
          sync_run_id: syncRunId,
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
          {
            label: `validador refresh ${phase}`,
            attempts: 2,
            baseDelayMs: 400,
            log,
          },
        );
        const more = collectSetCookieHeader(fetched.response.headers);
        if (more) cookies = mergeCookieStrings(cookies, more);
      } catch {
        /* ignore */
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

    async function postAcoesSnapshot(
      phase: string,
      cookieJar: string,
      pairs: Record<string, string>,
    ): Promise<AcoesResult> {
      try {
        const fetched = await fetchEpocPortalPostWithRetry(
          acoesUrl,
          {
            method: "POST",
            headers: headersAcoes(cookieJar, origin, validadorOzUrl),
            body: new URLSearchParams(pairs).toString(),
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

    for (
      const mod of [
        { key: "faturamento", modulo: MODULO_REL_FATURAMENTO },
        { key: "servicos", modulo: MODULO_REL_VENDA_SERVICOS },
        { key: "produtos", modulo: MODULO_REL_PRODUTO_SINTETICO },
      ] as const
    ) {
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
      }
    }

    for (let i = 0; i < diasConsulta.length; i++) {
      const diaBr = diasConsulta[i]!;
      const diaIso = brDateToIso(diaBr);
      const suffix = `c${chainAttempt}_d${String(i + 1).padStart(2, "0")}`;

      if (!(await postValidador(`fase2_${suffix}`))) {
        const row: EpocDayBundleDayResult = {
          date_br: diaBr,
          date_iso: diaIso,
          status: "error",
          message: "validadorOz falhou neste dia.",
        };
        chunkDayResults.push(row);
        if (diaIso) {
          await upsertEpocSyncDayStatus(admin, companyId, diaIso, {
            products_ok: false,
            services_ok: false,
            faturamento_ok: false,
            products_error: "validadorOz falhou",
            services_error: "validadorOz falhou",
            faturamento_error: "validadorOz falhou",
          });
        }
        await bumpLiveProgress();
        continue;
      }

      const cookieSnap = cookies;
      // Paralelo: faturamento + serviços + produtos
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
        const row: EpocDayBundleDayResult = {
          date_br: diaBr,
          date_iso: diaIso,
          status: "error",
          message: `acoes faturamento falhou: ${fatRes.text.slice(0, 200)}`,
        };
        chunkDayResults.push(row);
        if (diaIso) {
          await upsertEpocSyncDayStatus(admin, companyId, diaIso, {
            products_ok: false,
            services_ok: false,
            faturamento_ok: false,
            faturamento_error: fatRes.text.slice(0, 500),
            services_error: "bloqueado (faturamento falhou)",
            products_error: "bloqueado (faturamento falhou)",
          });
        }
        await bumpLiveProgress();
        continue;
      }

      const fatExtract = extractFaturamentoRowsFromAcoesHtml(fatRes.text, diaBr);
      if (!isFaturamentoDayUsable(fatExtract)) {
        // Sem faturamento ⇒ sem expediente ⇒ não processar produtos/serviços.
        const row: EpocDayBundleDayResult = {
          date_br: diaBr,
          date_iso: diaIso,
          status: "skipped_no_faturamento",
          message:
            fatExtract.message ??
            "Sem faturamento (Total Geral) — dia saltado (sem produtos/serviços).",
          faturamento_rows: fatExtract.rowCount,
        };
        chunkDayResults.push(row);
        if (diaIso) {
          await upsertEpocSyncDayStatus(admin, companyId, diaIso, {
            products_ok: true,
            services_ok: true,
            faturamento_ok: true,
            products_error: null,
            services_error: null,
            faturamento_error: null,
          });
        }
        log("dia_skip_sem_faturamento", { dia: diaBr });
        await bumpLiveProgress();
        continue;
      }

      const servExtract = servRes.ok
        ? extractVendaServicosRowsFromAcoesHtml(servRes.text, diaBr)
        : {
          dataConsulta: diaBr,
          itensCount: 0,
          resumoCount: 0,
          rows: [],
          maxCols: 0,
          message: `acoes serviços falhou: ${servRes.text.slice(0, 160)}`,
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
      dayHtmlBundles.push({
        diaBr,
        fatHtml: fatRes.text,
        servHtml: servRes.ok ? servRes.text : "",
      });

      chunkDayResults.push({
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
          ]
            .filter(Boolean)
            .join("; ") || undefined,
      });
      await bumpLiveProgress();
    }
  }

  // Persist domínio (serviços/faturamento) do lote
  for (const bundle of dayHtmlBundles) {
    const diaIso = brDateToIso(bundle.diaBr);
    if (!diaIso) continue;

    let servicesOk = false;
    let servicesError: string | null = null;
    let fatOk = false;
    let fatError: string | null = null;

    if (bundle.servHtml) {
      const p = await persistServicesFromAcoesHtml(
        admin,
        companyId,
        bundle.diaBr,
        bundle.servHtml,
      );
      servicesOk = p.ok;
      servicesError = p.ok ? null : (p.error ?? "falha persist serviços");
      persistAcc.push({
        day: diaIso,
        kind: "services",
        ok: p.ok,
        itens: p.itens ?? 0,
        error: servicesError,
      });
    } else {
      servicesError = "HTML serviços ausente";
      persistAcc.push({
        day: diaIso,
        kind: "services",
        ok: false,
        error: servicesError,
      });
    }

    if (bundle.fatHtml) {
      const p = await persistFaturamentoFromAcoesHtml(
        admin,
        companyId,
        bundle.diaBr,
        bundle.fatHtml,
      );
      fatOk = p.ok;
      fatError = p.ok ? null : (p.error ?? "falha persist faturamento");
      persistAcc.push({
        day: diaIso,
        kind: "faturamento",
        ok: p.ok,
        itens: p.itens ?? 0,
        error: fatError,
      });
    } else {
      fatError = "HTML faturamento ausente";
      persistAcc.push({
        day: diaIso,
        kind: "faturamento",
        ok: false,
        error: fatError,
      });
    }

    await upsertEpocSyncDayStatus(admin, companyId, diaIso, {
      products_ok: true, // CSV parcial / final trata o import
      services_ok: servicesOk,
      faturamento_ok: fatOk,
      products_error: null,
      services_error: servicesError,
      faturamento_error: fatError,
    });
  }

  const fatCsvChunk = buildFaturamentoConsolidatedCsv(fatExtracts);
  const servCsvChunk = buildVendaServicosConsolidatedCsv(servExtracts);
  const prodCsvChunk = buildProdutoSinteticoConsolidatedCsv(prodExtracts);
  // Contagens de linhas já acumuladas em bumpLiveProgress (por dia).

  const chunkTag = String(chainAttempt).padStart(2, "0");
  if (prodCsvChunk.csv.trim() && prodCsvChunk.totalRows > 0) {
    const path = `${stepsPrefix}/parts/produtos-${chunkTag}.csv`;
    const up = await uploadText(admin, path, prodCsvChunk.csv, STORAGE_CSV_CONTENT_TYPE);
    if (up.ok) partProd.push(up.path);
    else {
      log("part_upload_fail", { kind: "produtos", path, error: up.error });
    }
  }
  if (servCsvChunk.csv.trim() && servCsvChunk.totalRows > 0) {
    const path = `${stepsPrefix}/parts/servicos-${chunkTag}.csv`;
    const up = await uploadText(admin, path, servCsvChunk.csv, STORAGE_CSV_CONTENT_TYPE);
    if (up.ok) partServ.push(up.path);
    else {
      log("part_upload_fail", { kind: "servicos", path, error: up.error });
    }
  }
  if (fatCsvChunk.csv.trim() && fatCsvChunk.totalRows > 0) {
    const path = `${stepsPrefix}/parts/faturamento-${chunkTag}.csv`;
    const up = await uploadText(admin, path, fatCsvChunk.csv, STORAGE_CSV_CONTENT_TYPE);
    if (up.ok) partFat.push(up.path);
    else {
      log("part_upload_fail", { kind: "faturamento", path, error: up.error });
    }
  }

  // Índice estável no Storage (não depende do JSONB settings / body da cadeia).
  await writePartIndex(admin, stepsPrefix, {
    produtos: partProd,
    servicos: partServ,
    faturamento: partFat,
  });

  const diasDoneNext = [...diasDonePrior, ...diasConsulta];
  dayResultsAcc = [...dayResultsAcc, ...chunkDayResults];
  dayResultsPath = await writeDayResultsFile(stepsPrefix, dayResultsAcc) ??
    dayResultsPath;

  if (persistAcc.length > 0) {
    const pPath = `${stepsPrefix}/persist-log.json`;
    const up = await uploadText(
      admin,
      pPath,
      JSON.stringify(persistAcc),
      STORAGE_JSON_CONTENT_TYPE,
    );
    if (up.ok) persistPath = up.path;
  }

  const chainState: DaySyncChainState = {
    run_id: syncRunId,
    status: willContinue ? "fetching" : "done",
    steps_prefix: stepsPrefix,
    dias_planned_br: diasPlanned,
    dias_done_br: diasDoneNext,
    part_paths_produtos: partProd,
    part_paths_servicos: partServ,
    part_paths_faturamento: partFat,
    day_results_path: dayResultsPath,
    persist_path: persistPath,
    totals,
    requested_by: requestedBy,
    chain_attempt: chainAttempt,
    max_days: maxDaysPerInvoke,
    csv_import_job_id: null,
    final_paths: { produtos: null, faturamento: null, servicos: null },
    updated_at: new Date().toISOString(),
    last_error: null,
  };

  if (willContinue) {
    const saved = await persistChain(chainState);
    if (!saved.ok) {
      chainState.settings_write_error = saved.error;
      // Continua a cadeia mesmo assim (estado vai no payload).
    }
    const payload: EpocSyncDayContinuePayload = {
      company_id: companyId,
      continue_chain: true,
      chain_attempt: chainAttempt + 1,
      max_days: maxDaysPerInvoke,
      sync_run_id: syncRunId,
      steps_prefix: stepsPrefix,
      dias_planned_br: diasPlanned,
      dias_done_br: diasDoneNext,
      part_paths_produtos: partProd,
      part_paths_servicos: partServ,
      part_paths_faturamento: partFat,
      requested_by: requestedBy,
      totals,
    };
    triggerEpocSyncDayContinueInBackground({
      supabaseUrl,
      serviceKey,
      payload,
      logTag: LOG,
    });
    log("chain_next", {
      sync_run_id: syncRunId,
      next_attempt: chainAttempt + 1,
      days_done: diasDoneNext.length,
      days_planned: diasPlanned.length,
      settings_write_ok: saved.ok,
    });

    return json({
      ok: true,
      continuing: true,
      company_id: companyId,
      source: "epoc-sync-day",
      sync_run_id: syncRunId,
      chain_attempt: chainAttempt,
      days_done: diasDoneNext.length,
      days_planned: diasPlanned.length,
      days_label: `${diasDoneNext.length}/${diasPlanned.length} dias`,
      days_requested: diasConsulta,
      days: chunkDayResults,
      totals,
      storage_prefix: stepsPrefix,
      message:
        `Lote ${chainAttempt + 1} ok — a continuar (${diasDoneNext.length}/${diasPlanned.length} dias)…`,
    });
  }

  // --- Finalizar: merge + enqueue + settings -------------------------------
  // Recupera parts do Storage se o array em memória/settings veio vazio
  // (causa do final_paths null com totals > 0).
  const resolvedParts = await resolvePartPaths(admin, stepsPrefix, {
    produtos: partProd,
    servicos: partServ,
    faturamento: partFat,
  });
  partProd = resolvedParts.produtos;
  partServ = resolvedParts.servicos;
  partFat = resolvedParts.faturamento;
  log("finalize_parts", {
    sync_run_id: syncRunId,
    produtos: partProd.length,
    servicos: partServ.length,
    faturamento: partFat.length,
    totals,
  });

  async function mergeParts(paths: string[]): Promise<string> {
    const texts: string[] = [];
    for (const p of paths) {
      const t = await downloadText(admin, p);
      if (t) texts.push(t);
      else log("part_download_fail", { path: p });
    }
    return mergeCsvPartTexts(texts);
  }

  let prodFinal = await mergeParts(partProd);
  let servFinal = await mergeParts(partServ);
  let fatFinal = await mergeParts(partFat);

  // Se merge falhou mas o lote atual tem CSV em memória, usa-o (último recurso).
  if (!prodFinal.trim() && prodCsvChunk.csv.trim() && prodCsvChunk.totalRows > 0) {
    prodFinal = prodCsvChunk.csv;
  }
  if (!servFinal.trim() && servCsvChunk.csv.trim() && servCsvChunk.totalRows > 0) {
    servFinal = servCsvChunk.csv;
  }
  if (!fatFinal.trim() && fatCsvChunk.csv.trim() && fatCsvChunk.totalRows > 0) {
    fatFinal = fatCsvChunk.csv;
  }

  const finalPaths = {
    produtos: null as string | null,
    faturamento: null as string | null,
    servicos: null as string | null,
  };
  if (prodFinal.trim()) {
    const path = `${stepsPrefix}/produtos.csv`;
    const up = await uploadText(admin, path, prodFinal, STORAGE_CSV_CONTENT_TYPE);
    if (up.ok) finalPaths.produtos = up.path;
    else log("final_upload_fail", { kind: "produtos", error: up.error });
  }
  if (servFinal.trim()) {
    const path = `${stepsPrefix}/servicos.csv`;
    const up = await uploadText(admin, path, servFinal, STORAGE_CSV_CONTENT_TYPE);
    if (up.ok) finalPaths.servicos = up.path;
    else log("final_upload_fail", { kind: "servicos", error: up.error });
  }
  if (fatFinal.trim()) {
    const path = `${stepsPrefix}/faturamento.csv`;
    const up = await uploadText(admin, path, fatFinal, STORAGE_CSV_CONTENT_TYPE);
    if (up.ok) finalPaths.faturamento = up.path;
    else log("final_upload_fail", { kind: "faturamento", error: up.error });
  }

  if (!finalPaths.produtos && !finalPaths.servicos && !finalPaths.faturamento) {
    log("finalize_sem_csv", {
      sync_run_id: syncRunId,
      steps_prefix: stepsPrefix,
      part_counts: {
        produtos: partProd.length,
        servicos: partServ.length,
        faturamento: partFat.length,
      },
      totals,
    });
  }

  const prodRowsFinal = prodFinal.trim()
    ? Math.max(0, prodFinal.trim().split(/\r?\n/).filter(Boolean).length - 1)
    : 0;

  let csvRevenueImportJobId: string | null = null;
  let csvJobError: string | null = null;
  if (finalPaths.produtos && prodRowsFinal > 0) {
    const enqueue = await enqueueAndTriggerEpocCsvImport(admin, {
      companyId,
      requestedBy,
      storagePath: finalPaths.produtos,
      storageBucket: STORAGE_BUCKET,
      metadata: {
        source: "epoc-sync-day",
        steps_prefix: stepsPrefix,
        sync_run_id: syncRunId,
        linhas_dados: prodRowsFinal,
        consulta_dias_br: diasPlanned,
        faturamento_csv_path: finalPaths.faturamento,
        servicos_csv_path: finalPaths.servicos,
      },
      supabaseUrl,
      serviceKey,
      anonKey,
      logTag: LOG,
    });
    if (!enqueue.jobId) {
      csvJobError = enqueue.error ?? "enqueue falhou";
    } else {
      csvRevenueImportJobId = enqueue.jobId;
      if (!enqueue.triggerOk) {
        csvJobError = enqueue.triggerError ?? "trigger falhou";
      }
    }
  }

  const syncGaps = await listEpocSyncGaps(admin, companyId);
  const partialSummary = buildPartialSyncSummary(syncGaps);
  const nowIso = new Date().toISOString();

  const doneState: DaySyncChainState = {
    ...chainState,
    status: "done",
    csv_import_job_id: csvRevenueImportJobId,
    final_paths: finalPaths,
    day_results_path: dayResultsPath,
    persist_path: persistPath,
    updated_at: nowIso,
    last_error: csvJobError,
  };

  const nextSettings: Record<string, unknown> = {
    ...raw,
    [CHAIN_SETTINGS_KEY]: doneState,
    last_epoc_day_sync_at: nowIso,
    last_epoc_day_sync_prefix: stepsPrefix,
    last_epoc_day_sync_produtos_csv: finalPaths.produtos,
    last_epoc_day_sync_faturamento_csv: finalPaths.faturamento,
    last_epoc_day_sync_servicos_csv: finalPaths.servicos,
    last_epoc_day_sync_job_id: csvRevenueImportJobId,
    epoc_partial_sync_summary: partialSummary,
    epoc_partial_sync_missing_services_days: syncGaps.services,
    epoc_partial_sync_missing_faturamento_days: syncGaps.faturamento,
    epoc_partial_sync_at: nowIso,
  };
  if (finalPaths.produtos) {
    nextSettings.last_epoc_csv_sync_at = nowIso;
    nextSettings.last_epoc_csv_storage_path = finalPaths.produtos;
  }

  const { error: finalSettingsErr } = await admin
    .from("company_integrations")
    .update({ settings: nextSettings, updated_at: nowIso })
    .eq("company_id", companyId)
    .eq("provider", "epoc");
  if (finalSettingsErr) {
    log("settings_final_falhou", { message: finalSettingsErr.message });
    // Fallback mínimo: grava só paths finais (sem cadeia pesada).
    const minimal = {
      ...raw,
      last_epoc_day_sync_at: nowIso,
      last_epoc_day_sync_prefix: stepsPrefix,
      last_epoc_day_sync_produtos_csv: finalPaths.produtos,
      last_epoc_day_sync_faturamento_csv: finalPaths.faturamento,
      last_epoc_day_sync_servicos_csv: finalPaths.servicos,
      last_epoc_day_sync_job_id: csvRevenueImportJobId,
      [CHAIN_SETTINGS_KEY]: {
        run_id: syncRunId,
        status: "done",
        steps_prefix: stepsPrefix,
        dias_planned_br: diasPlanned,
        dias_done_br: diasDoneNext,
        part_paths_produtos: partProd,
        part_paths_servicos: partServ,
        part_paths_faturamento: partFat,
        day_results_path: dayResultsPath,
        persist_path: persistPath,
        totals,
        requested_by: requestedBy,
        chain_attempt: chainAttempt,
        max_days: maxDaysPerInvoke,
        csv_import_job_id: csvRevenueImportJobId,
        final_paths: finalPaths,
        updated_at: nowIso,
        last_error: csvJobError,
        settings_write_error: finalSettingsErr.message,
      },
    };
    await admin
      .from("company_integrations")
      .update({ settings: minimal, updated_at: nowIso })
      .eq("company_id", companyId)
      .eq("provider", "epoc");
  }

  log("done", {
    company_id: companyId,
    sync_run_id: syncRunId,
    days_planned: diasPlanned.length,
    totals,
    job_id: csvRevenueImportJobId,
    final_paths: finalPaths,
    settings_ok: !finalSettingsErr,
  });

  return json({
    ok: true,
    continuing: false,
    company_id: companyId,
    source: "epoc-sync-day",
    sync_run_id: syncRunId,
    chain_attempt: chainAttempt,
    days_done: diasDoneNext.length,
    days_planned: diasPlanned.length,
    days_label: `${diasPlanned.length} dia(s)`,
    days_requested: diasPlanned,
    days: dayResultsAcc,
    storage_bucket: STORAGE_BUCKET,
    storage_prefix: stepsPrefix,
    storage_paths: finalPaths,
    persist: persistAcc,
    csv_import_job_id: csvRevenueImportJobId,
    csv_import_error: csvJobError,
    partial_sync_summary: partialSummary,
    csv: {
      produtos: prodFinal,
      faturamento: fatFinal,
      servicos: servFinal,
    },
    has_csv: !!(
      prodFinal.trim() || fatFinal.trim() || servFinal.trim()
    ),
    totals,
    stats: {
      ...totals,
      produtos_dias_com_dados: dayResultsAcc.filter(
        (d) => d.status === "ok" && (d.produtos_rows ?? 0) > 0,
      ).length,
      faturamento_dias_com_dados: dayResultsAcc.filter(
        (d) => d.status === "ok" && (d.faturamento_rows ?? 0) > 0,
      ).length,
      servicos_dias_com_dados: dayResultsAcc.filter(
        (d) => d.status === "ok" && (d.servicos_rows ?? 0) > 0,
      ).length,
    },
  });
});

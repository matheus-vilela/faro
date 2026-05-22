/**
 * EPOC: cada etapa do portal é guardada e disponibilizada no Storage como `step` para
 * download e inspeção (login → index → validadorOz/acoes fase1 → validadorOz/acoes fase2).
 * Cada step traz: bytes, content-type, http_status, presença de ids relevantes
 * (`ConteudoTela`, `tblExport`) e URL assinada. O sucesso só é declarado quando a
 * fase 2 contém `id=tblExport`; mesmo no erro o JSON inclui o trace com as URLs.
 *
 * O CSV consolidado inclui apenas linhas de dados com a coluna "Total recebido(R$)"
 * preenchida (célula não vazia após trim), quando essa coluna existir no cabeçalho.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { performEpocPortalLogin } from "../_shared/epocPortalLoginSession.ts";
import {
  isOnboardingPdvSyncInProgress,
  patchOnboardingPdv,
  type OnboardingPdvPatch,
} from "../_shared/onboardingPdvPatch.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOG = "[epoc-sync-csv]";

const DEFAULT_LOGIN_PATH = "/index.php";

/** POST com NaoMenu+token, como no curl do browser, antes de `acoes.php`. */
const PATH_VALIDADOR_OZ = "/validadorOz.php";
const PATH_ACOES = "/acoes.php";
const MODULO_REL = "mod_rel_produto_sintetico";
const DEFAULT_NAOMENU = "123A";

/** Só usamos o `id` destes nós (como no DOM do EPOC) — sem classes ou outros atributos. */
const EPOC_ID_CONTEUDO_TELA = "ConteudoTela";
const EPOC_ID_TBL_EXPORT = "tblExport";

/** Alinhado ao import `process-integration-csv-revenue-job`; CSV final sem linhas com esta coluna vazia. */
const COL_TOTAL_RECEBIDO = "Total recebido(R$)";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

interface OnboardingPdv {
  sync: boolean;
  completed: boolean;
  sales_sync: number;
  portal_busy: boolean;
  sales_total: number;
  import_error: string | null;
  import_status: string | null;
  portal_message: string | null;
  portal_outcome: string | null;
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
    Accept: "application/json, text/javascript, */*;q=0.01",
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

/** Resposta pode ser HTML puro ou JSON com HTML em `conteudo`/`html`/… */
function unwrapAcoesHtml(text: string): string {
  const t = text.replace(/^\uFEFF/, "").trim();
  if (!t.startsWith("{")) return t;
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    for (const k of ["conteudo", "html", "dados", "tela_html"]) {
      if (typeof j[k] === "string" && (j[k] as string).length > 0) {
        return j[k] as string;
      }
    }
  } catch {
    /* manter texto */
  }
  return t;
}

/** Texto típico do EPOC quando não há dados no intervalo / filtro (aparece em `previa` da resposta). */
const EPOC_MSG_SEM_EVENTO_COM_FILTRO =
  "Não foi encontrado nenhum evento com esse filtro";

/** Devolve a mensagem canónica do portal quando o texto bruto/HTML a contém. */
function mensagemPortalSemEventosPorFiltro(rawText: string): string | null {
  const t = unwrapAcoesHtml(rawText);
  return t.includes(EPOC_MSG_SEM_EVENTO_COM_FILTRO)
    ? EPOC_MSG_SEM_EVENTO_COM_FILTRO
    : null;
}

/**
 * Só procura o par atributo `id` = valor (valor fixo, exato). Ignora tag, classes, etc.
 * Ex.: `<div id="ConteudoTela" class="...">` e `<table class="a" id="tblExport" …>`.
 */
function idAttributeInMarkupRegex(elementId: string): RegExp {
  const e = elementId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `\\bid\\s*=\\s*["']${e}["']|\\bid\\s*=\\s*${e}(?=[\\s/>])`,
    "i",
  );
}

function htmlHasId(html: string, elementId: string): boolean {
  return idAttributeInMarkupRegex(elementId).test(html);
}

/** `>` que fecha a tag de abertura (respeita aspas em atributos; não trata comentários). */
function endOfStartTagIndex(html: string, lt: number): number {
  if (html[lt] !== "<") return -1;
  let inQuote: '"' | "'" | null = null;
  for (let i = lt + 1; i < html.length; i++) {
    const c = html[i];
    if (inQuote) {
      if (c === inQuote) inQuote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inQuote = c;
      continue;
    }
    if (c === ">") return i;
  }
  return -1;
}

function hasConteudoTela(html: string): boolean {
  return htmlHasId(unwrapAcoesHtml(html), EPOC_ID_CONTEUDO_TELA);
}

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

/**
 * Se o utilizador colar a URL completa do portal (`.../index.php`), usa só a origem
 * para compor paths (`/index.php`, `acoes.php`, etc.) e evita `.../index.php/index.php`.
 */
function normalizeEpocBaseUrl(base: string): string {
  const t = trimBaseUrl(base);
  const lower = t.toLowerCase();
  const suf = "/index.php";
  if (lower.endsWith(suf)) {
    return (
      t.slice(0, -suf.length).replace(/\/$/, "") || t.slice(0, -suf.length)
    );
  }
  return t;
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

function cookieNameList(jar: string): string {
  if (!jar.trim()) return "(vazio)";
  return jar
    .split(/;\s*/)
    .map((p) => p.split("=")[0]?.trim() ?? "")
    .filter(Boolean)
    .join(", ");
}

function previewText(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… (${s.length} chars)`;
}

/** Dispara import de receitas a partir do CSV (não depende só do Database Webhook). */
function scheduleProcessCsvRevenueJob(
  supabaseUrl: string,
  serviceKey: string,
  anonKey: string,
  jobId: string,
): void {
  const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/process-integration-csv-revenue-job`;
  const trigger = fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ job_id: jobId }),
  }).catch((err) => {
    console.error(LOG, "process_csv_revenue_job_trigger_falhou", {
      job_id: jobId,
      err: String(err),
    });
  });
  try {
    // @ts-ignore EdgeRuntime.waitUntil prolonga o isolate até o fetch terminar
    if (
      typeof EdgeRuntime !== "undefined" &&
      typeof EdgeRuntime.waitUntil === "function"
    ) {
      // @ts-ignore
      EdgeRuntime.waitUntil(trigger);
    }
  } catch {
    void trigger;
  }
}

const VOID_HTML = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/**
 * Outer HTML de um nó: ancora no **valor do `id` na resposta** (não exige `class` nem ordem de atributos),
 * encontra a tag de abertura a que esse `id` pertence e equilibra abre/fecha.
 */
function extractElementOuterHtmlById(
  html: string,
  elementId: string,
): string | null {
  if (!htmlHasId(html, elementId)) return null;
  const reId = new RegExp(idAttributeInMarkupRegex(elementId).source, "gi");
  const inTag = idAttributeInMarkupRegex(elementId);
  let m: RegExpExecArray | null;
  const maxIdDistance = 10_000;
  while ((m = reId.exec(html)) !== null) {
    const idIdx = m.index;
    const openStart = html.lastIndexOf("<", idIdx);
    if (openStart < 0 || idIdx - openStart > maxIdDistance) continue;
    if (html.slice(openStart, openStart + 4) === "<!--") continue;
    const tagHeadEnd = endOfStartTagIndex(html, openStart);
    if (tagHeadEnd < 0) continue;
    if (idIdx < openStart || idIdx + m[0].length > tagHeadEnd) continue;
    const openTag = html.slice(openStart, tagHeadEnd + 1);
    inTag.lastIndex = 0;
    if (!inTag.test(openTag)) continue;
    const nameMatch = /^<\s*([a-zA-Z][\w:-]*)\b/i.exec(openTag);
    if (!nameMatch) continue;
    const tagName = (nameMatch[1] ?? "").toLowerCase();
    if (VOID_HTML.has(tagName)) return openTag;
    const tagEsc = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const reOpen = new RegExp(`<\\s*${tagEsc}\\b`, "i");
    const reClose = new RegExp(`<\\/\\s*${tagEsc}\\s*>`, "i");
    const start = openStart;
    let i = tagHeadEnd + 1;
    let depth = 1;
    const h = html;
    while (i < h.length && depth > 0) {
      const rest = h.slice(i);
      const nextOpen = rest.search(reOpen);
      const nextCloseM = reClose.exec(rest);
      if (!nextCloseM) {
        break;
      }
      const nextClose = nextCloseM.index;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        i += nextOpen;
        const gt = h.indexOf(">", i);
        if (gt === -1) {
          break;
        }
        i = gt + 1;
      } else {
        const closePos = i + nextClose;
        const len = nextCloseM[0].length;
        depth -= 1;
        if (depth === 0) {
          return h.slice(start, closePos + len);
        }
        i = closePos + len;
      }
    }
  }
  return null;
}

/** Detalhes simples sobre o conteúdo de uma resposta. */
function inspectResponseHtml(text: string): {
  has_id_conteudo_tela: boolean;
  has_id_tbl_export: boolean;
  has_login_form: boolean;
  has_token_field: boolean;
  parece_json: boolean;
} {
  const t = unwrapAcoesHtml(text);
  return {
    has_id_conteudo_tela: htmlHasId(t, EPOC_ID_CONTEUDO_TELA),
    has_id_tbl_export: htmlHasId(t, EPOC_ID_TBL_EXPORT),
    has_login_form:
      /name\s*=\s*["'](?:senha|password|user|usuario)["']/i.test(t) &&
      /<form\b[^>]*>/i.test(t),
    has_token_field:
      /name\s*=\s*["']token["']/i.test(t) || /Tente_A_Vontade_/i.test(t),
    parece_json: text
      .replace(/^\uFEFF/, "")
      .trim()
      .startsWith("{"),
  };
}

type StepStatus = "ok" | "fail" | "warn";
interface StepRecord {
  index: number;
  name: string;
  label: string;
  status: StepStatus;
  http_status?: number | null;
  content_type?: string | null;
  bytes?: number;
  message?: string;
  storage_path?: string | null;
  file_name?: string | null;
  download_url?: string | null;
  detalhes?: Record<string, unknown>;
}

function formatDateBr(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** Janela dos últimos N dias (inclui hoje), do mais antigo para o mais recente. */
function lastNDaysBr(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    out.push(formatDateBr(d));
  }
  return out;
}

/**
 * Ontem civil no fuso `tz` (ex.: America/Sao_Paulo), em dd/MM/aaaa como o EPOC espera em data_de/data_ate.
 * Caminha para trás em passos de 1h até o calendário no fuso mudar em relação a “hoje”.
 */
/** Até 10 datas dd/MM/aaaa para repetir uma janela (UI / histórico). */
function normalizeConsultaDiasBrInput(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string") return null;
    const t = x.trim();
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(t)) return null;
    out.push(t);
  }
  if (out.length === 0) return null;
  return out.slice(0, 10);
}

function yesterdayDateBrInTz(tz: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
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
      const parts = ymdInTz(probe).split("-");
      const [y, m, d] = parts.map((x) => parseInt(x, 10));
      return `${pad(d)}/${pad(m)}/${y}`;
    }
    probe = new Date(probe.getTime() - 60 * 60 * 1000);
  }
  const [y0, m0, d0] = today.split("-").map((x) => parseInt(x, 10));
  const fb = new Date(Date.UTC(y0, m0 - 1, d0 - 1));
  return `${pad(fb.getUTCDate())}/${pad(fb.getUTCMonth() + 1)}/${fb.getUTCFullYear()}`;
}

function daysInCalendarMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/**
 * Onboarding EPOC: do 1.º dia do mês civil anterior até ontem (America/Sao_Paulo), inclusive.
 * Ex.: 02/05/2026 → 01/04/2026 … 01/05/2026; 15/06/2026 → 01/05/2026 … 14/06/2026.
 */
function onboardingEpocConsultaDaysSaoPaulo(): string[] {
  const tz = "America/Sao_Paulo";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const getPart = (t: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === t)?.value ?? 0);
  const ty = getPart("year");
  const tm = getPart("month");

  const yBr = yesterdayDateBrInTz(tz);
  const yParts = yBr.split("/");
  const ey = parseInt(yParts[2] ?? "0", 10);
  const em = parseInt(yParts[1] ?? "0", 10);
  const ed = parseInt(yParts[0] ?? "0", 10);

  let sy = ty;
  let sm = tm - 1;
  if (sm < 1) {
    sm = 12;
    sy = ty - 1;
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const out: string[] = [];
  let y = sy;
  let mm = sm;
  let dd = 1;
  for (;;) {
    out.push(`${pad(dd)}/${pad(mm)}/${y}`);
    if (y === ey && mm === em && dd === ed) break;
    const dim = daysInCalendarMonth(y, mm);
    dd++;
    if (dd > dim) {
      dd = 1;
      mm++;
      if (mm > 12) {
        mm = 1;
        y++;
      }
    }
  }
  return out;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
}

function normalizeCellText(cellHtml: string): string {
  const noScripts = cellHtml
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");
  const withBreaks = noScripts.replace(/<br\s*\/?>/gi, "\n");
  const plain = withBreaks.replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(plain).replace(/\s+/g, " ").trim();
}

function csvEscapeCell(v: string): string {
  const s = v.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const needsQuote = /[",;\n]/.test(s);
  const esc = s.replace(/"/g, '""');
  return needsQuote ? `"${esc}"` : esc;
}

/** Converte a table HTML em CSV delimitado por ';' (pt-BR friendly). */
function tableHtmlToCsv(tableHtml: string): string | null {
  const rows: string[] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trM: RegExpExecArray | null;
  while ((trM = trRe.exec(tableHtml)) !== null) {
    const rowInner = trM[1] ?? "";
    const cols: string[] = [];
    const cellRe = /<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
    let cM: RegExpExecArray | null;
    while ((cM = cellRe.exec(rowInner)) !== null) {
      cols.push(csvEscapeCell(normalizeCellText(cM[1] ?? "")));
    }
    if (cols.length > 0) rows.push(cols.join(";"));
  }
  if (rows.length === 0) return null;
  return `${rows.join("\n")}\n`;
}

function normalizeHeaderLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");
}

function findTotalRecebidoColumnIndex(headers: string[]): number {
  const want = normalizeHeaderLabel(COL_TOTAL_RECEBIDO);
  for (let i = 0; i < headers.length; i++) {
    if (normalizeHeaderLabel(headers[i] ?? "") === want) return i;
  }
  for (let i = 0; i < headers.length; i++) {
    const h = normalizeHeaderLabel(headers[i] ?? "");
    if (h.includes("totalrecebido")) return i;
  }
  return -1;
}

/** Valor “preenchido” para o CSV: não vazio após trim (NBSP / zero-width removidos). */
function isTotalRecebidoCellFilled(raw: string): boolean {
  const t = raw
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .trim();
  return t.length > 0;
}

function extractTableHeaderAndRows(tableHtml: string): {
  header: string[];
  rows: string[][];
} {
  const rows: string[][] = [];
  let header: string[] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trM: RegExpExecArray | null;
  while ((trM = trRe.exec(tableHtml)) !== null) {
    const rowInner = trM[1] ?? "";
    const isHeader = /<th\b/i.test(rowInner);
    const cols: string[] = [];
    const cellRe = /<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
    let cM: RegExpExecArray | null;
    while ((cM = cellRe.exec(rowInner)) !== null) {
      cols.push(normalizeCellText(cM[1] ?? ""));
    }
    if (cols.length === 0) continue;
    if (isHeader && header.length === 0) {
      header = cols;
    } else {
      rows.push(cols);
    }
  }
  if (header.length === 0 && rows.length > 0) {
    header = rows.shift() ?? [];
  }
  return { header, rows };
}

function matrixToCsv(header: string[], rows: string[][]): string {
  const lines: string[] = [];
  lines.push(header.map(csvEscapeCell).join(";"));
  for (const row of rows) {
    lines.push(row.map(csvEscapeCell).join(";"));
  }
  return `${lines.join("\n")}\n`;
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
    return json(
      { ok: false, error: "Configuração do servidor incompleta" },
      500,
    );
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "Não autenticado" }, 401);
  }
  const bearer = authHeader.slice("Bearer ".length).trim();

  type SyncBody = {
    company_id?: string;
    sync_mode?: string;
    requested_by?: string;
    consulta_dias_br?: unknown;
  };
  let body: SyncBody = {};
  try {
    body = (await req.json()) as SyncBody;
  } catch {
    return json({ ok: false, error: "JSON inválido" }, 400);
  }
  const companyId =
    typeof body.company_id === "string" ? body.company_id.trim() : "";
  if (!companyId) {
    return json({ ok: false, error: "company_id é obrigatório" }, 400);
  }

  const syncMode: "full" | "previous_day" | "onboarding_initial" =
    body.sync_mode === "previous_day"
      ? "previous_day"
      : body.sync_mode === "onboarding_initial"
        ? "onboarding_initial"
        : "full";
  const manualConsultaDias = normalizeConsultaDiasBrInput(
    body.consulta_dias_br,
  );

  const admin = createClient(supabaseUrl, serviceKey);
  const serviceKeyNorm = serviceKey.trim();
  const bearerNorm = bearer.trim();
  const isServiceInvoke =
    bearerNorm.length > 0 && bearerNorm === serviceKeyNorm;

  let userIdForJob: string;

  let integ: { enabled: boolean; settings: unknown } | null;
  let integErr: { message: string } | null = null;

  if (isServiceInvoke) {
    const rbRaw =
      typeof body.requested_by === "string" ? body.requested_by.trim() : "";
    if (rbRaw) {
      const { data: link } = await admin
        .from("user_companies")
        .select("user_id")
        .eq("company_id", companyId)
        .eq("user_id", rbRaw)
        .maybeSingle();
      if (!link) {
        return json(
          { ok: false, error: "requested_by não pertence a esta unidade" },
          403,
        );
      }
      userIdForJob = rbRaw;
    } else {
      const { data: members, error: memErr } = await admin
        .from("user_companies")
        .select("user_id, role")
        .eq("company_id", companyId);
      if (memErr) {
        return json({ ok: false, error: memErr.message }, 500);
      }
      const list = members ?? [];
      const owner = list.find((m) => m.role === "owner");
      const picked = owner?.user_id ?? list[0]?.user_id;
      if (!picked) {
        return json(
          { ok: false, error: "Unidade sem utilizador em user_companies" },
          400,
        );
      }
      userIdForJob = picked;
    }

    const integRes = await admin
      .from("company_integrations")
      .select("enabled, settings")
      .eq("company_id", companyId)
      .eq("provider", "epoc")
      .maybeSingle();
    integ = integRes.data;
    integErr = integRes.error;
  } else {
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return json({ ok: false, error: "Sessão inválida" }, 401);
    }
    userIdForJob = user.id;

    const { data: member } = await supabase
      .from("user_companies")
      .select("role")
      .eq("company_id", companyId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member) {
      return json({ ok: false, error: "Sem acesso a esta unidade" }, 403);
    }

    const integRes = await supabase
      .from("company_integrations")
      .select("enabled, settings")
      .eq("company_id", companyId)
      .eq("provider", "epoc")
      .maybeSingle();
    integ = integRes.data;
    integErr = integRes.error;
  }

  if (integErr) {
    return json({ ok: false, error: integErr.message }, 500);
  }
  if (!integ) {
    return json({ ok: false, error: "Integração EPOC não encontrada" }, 404);
  }
  if (!integ.enabled) {
    return json({ ok: false, error: "Integração inativa" }, 400);
  }

  if (syncMode === "previous_day") {
    const { data: companyRow, error: companyErr } = await admin
      .from("companies")
      .select("onboarding_pdv")
      .eq("id", companyId)
      .maybeSingle();
    if (companyErr) {
      return json({ ok: false, error: companyErr.message }, 500);
    }
    if (isOnboardingPdvSyncInProgress(companyRow?.onboarding_pdv)) {
      return json(
        {
          ok: false,
          error:
            "Sincronização PDV do onboarding em curso. A rotina diária EPOC não pode executar agora.",
        },
        409,
      );
    }
  }

  /** Só o fluxo `onboarding_initial` atualiza `onboarding_pdv` (card do dashboard). */
  const patchOnboardingPdvEnabled = syncMode === "onboarding_initial";

  async function patchOb(patch: OnboardingPdvPatch): Promise<void> {
    if (!patchOnboardingPdvEnabled) return;
    await patchOnboardingPdv(admin, companyId, patch, LOG);
  }

  const raw = (integ.settings ?? {}) as Record<string, unknown>;
  const baseUrl = normalizeEpocBaseUrl(String(raw.base_url ?? "").trim());
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

  const loginPath =
    String(raw.portal_login_path ?? "").trim() || DEFAULT_LOGIN_PATH;
  const userFieldFromSettings =
    String(raw.portal_user_field ?? "").trim() || "";
  const passFieldFromSettings =
    String(raw.portal_password_field ?? "").trim() || "";
  const hidden: Record<string, string> = {};
  const hiddenRaw = raw.portal_hidden_fields;
  if (hiddenRaw && typeof hiddenRaw === "object" && !Array.isArray(hiddenRaw)) {
    for (const [k, v] of Object.entries(hiddenRaw as Record<string, unknown>)) {
      if (v != null) hidden[k] = String(v);
    }
  }

  const fileStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const stepsPrefix = `${companyId}/epoc-sync/${fileStamp}/`;
  const signedTtl = 60 * 60;
  const steps: StepRecord[] = [];

  /** Faz upload do conteúdo do passo no Storage e devolve o registo já com signed URL. */
  async function recordStepWithUpload(
    name: string,
    label: string,
    fileName: string,
    bytes: Uint8Array,
    contentType: string,
    base: Partial<StepRecord> = {},
  ): Promise<StepRecord> {
    const idx = steps.length + 1;
    const path = `${stepsPrefix}${String(idx).padStart(2, "0")}-${fileName}`;
    const det: Record<string, unknown> = { ...(base.detalhes ?? {}) };
    let storagePath: string | null = null;
    let fileNameOut: string | null = null;
    let downloadUrl: string | null = null;
    const normalizedContentType =
      contentType.split(";")[0].trim().toLowerCase() ||
      "application/octet-stream";
    let upErrMsg: string | null = null;
    {
      const { error: upErr } = await admin.storage
        .from("company-setup")
        .upload(path, bytes, {
          contentType: normalizedContentType,
          upsert: false,
        });
      if (upErr) upErrMsg = upErr.message;
    }
    if (upErrMsg && /mime type .* is not supported/i.test(upErrMsg)) {
      const { error: retryErr } = await admin.storage
        .from("company-setup")
        .upload(path, bytes, {
          contentType: "application/octet-stream",
          upsert: false,
        });
      if (!retryErr) upErrMsg = null;
      else upErrMsg = retryErr.message;
    }
    if (upErrMsg) {
      det.upload_error = upErrMsg;
      det.upload_content_type = normalizedContentType;
    } else {
      storagePath = path;
      fileNameOut = path.split("/").pop() ?? null;
      const { data: signed, error: signErr } = await admin.storage
        .from("company-setup")
        .createSignedUrl(path, signedTtl, {
          download: fileNameOut ?? undefined,
        });
      if (signErr) det.sign_error = signErr.message;
      else downloadUrl = signed?.signedUrl ?? null;
    }
    const step: StepRecord = {
      index: idx,
      name,
      label,
      status: base.status ?? "ok",
      http_status: base.http_status ?? null,
      content_type: normalizedContentType,
      bytes: bytes.length,
      message: base.message,
      storage_path: storagePath,
      file_name: fileNameOut,
      download_url: downloadUrl,
      detalhes: det,
    };
    steps.push(step);
    log(`step.${name}`, {
      index: step.index,
      label,
      status: step.status,
      http_status: step.http_status,
      bytes: step.bytes,
      storage_path: storagePath,
      message: step.message,
      detalhes: det,
    });
    return step;
  }

  function recordStepWithoutUpload(
    name: string,
    label: string,
    base: Partial<StepRecord>,
  ): StepRecord {
    const idx = steps.length + 1;
    const step: StepRecord = {
      index: idx,
      name,
      label,
      status: base.status ?? "ok",
      http_status: base.http_status ?? null,
      content_type: base.content_type ?? null,
      bytes: base.bytes ?? 0,
      message: base.message,
      storage_path: null,
      file_name: null,
      download_url: null,
      detalhes: base.detalhes ?? {},
    };
    steps.push(step);
    log(`step.${name}`, {
      index: step.index,
      label,
      status: step.status,
      message: step.message,
      detalhes: step.detalhes,
    });
    return step;
  }

  async function failJson(
    httpStatus: number,
    error: string,
    extras: Record<string, unknown> = {},
    opts?: { skipPortalPatch?: boolean },
  ): Promise<Response> {
    if (!opts?.skipPortalPatch) {
      await patchOb({
        portal_busy: false,
        portal_outcome: "failed",
        portal_message: error.slice(0, 500),
        sync: false,
      });
    }
    return json(
      {
        ok: false,
        error,
        steps_prefix: stepsPrefix,
        steps,
        signed_url_expires_in: signedTtl,
        ...extras,
      },
      httpStatus,
    );
  }

  await patchOb({
    portal_busy: true,
    portal_outcome: null,
    portal_message: null,
    import_error: null,
  });

  log("inicio", {
    company_id: companyId,
    naoMenu,
    steps_prefix: stepsPrefix,
  });

  const loginResult = await performEpocPortalLogin({
    normalizedBaseUrl: baseUrl,
    username,
    password,
    loginPath,
    userFieldFromSettings,
    passFieldFromSettings,
    hidden,
    recording: {
      recordUpload: (name, label, fileName, bytes, contentType, base) =>
        recordStepWithUpload(
          name,
          label,
          fileName,
          bytes,
          contentType,
          base as Partial<StepRecord>,
        ),
      recordPlain: (name, label, base) =>
        recordStepWithoutUpload(name, label, base as Partial<StepRecord>),
    },
  });

  if (!loginResult.ok) {
    return await failJson(502, loginResult.message, {
      epoc_error_code: loginResult.errorCode,
    });
  }

  let cookies = loginResult.cookies;
  let token = loginResult.token;
  const origin = loginResult.origin;
  const refererIndex = loginResult.refererIndex;

  // Volta ao comportamento padrão de enviar o token de sessão quando extraído.
  // Para depuração, `send_token: false` em settings força `token=` vazio.
  const sendToken = raw.send_token !== false;
  const tokenForBody = sendToken ? token : "";
  recordStepWithoutUpload("token_envio", "Token usado nos POSTs", {
    status: tokenForBody ? "ok" : "warn",
    message: tokenForBody
      ? "Token de sessão incluído nos bodies de validador/acoes."
      : "Token não enviado (vazio) por configuração ou ausência no index.",
    detalhes: {
      send_token: sendToken,
      token_len: tokenForBody.length,
      token_previa: previewText(tokenForBody, 24),
    },
  });

  const validadorOzUrl = resolveUrlAgainstBase(baseUrl, PATH_VALIDADOR_OZ);
  const acoesUrl = resolveUrlAgainstBase(baseUrl, PATH_ACOES);
  const validadorBody = new URLSearchParams({
    NaoMenu: naoMenu,
    token: tokenForBody,
  }).toString();

  /** Faz `validadorOz.php` e regista resposta. */
  async function callValidador(phaseLabel: string): Promise<StepRecord> {
    let res: Response;
    try {
      res = await fetch(validadorOzUrl, {
        method: "POST",
        headers: headersValidador(cookies, origin, refererIndex),
        body: validadorBody,
        redirect: "follow",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return recordStepWithoutUpload(
        `validador_${phaseLabel}`,
        `POST validadorOz.php (${phaseLabel})`,
        { status: "fail", message: msg },
      );
    }
    {
      const more = collectSetCookieHeader(res.headers);
      if (more) cookies = mergeCookieStrings(cookies, more);
    }
    const text = await res.text();
    return recordStepWithUpload(
      `validador_${phaseLabel}`,
      `POST validadorOz.php (${phaseLabel})`,
      `validador-${phaseLabel}.txt`,
      new TextEncoder().encode(text),
      res.headers.get("Content-Type") ?? "text/plain; charset=utf-8",
      {
        http_status: res.status,
        status: res.ok ? "ok" : "fail",
        message: res.ok ? undefined : `HTTP ${res.status}`,
        detalhes: {
          previa: previewText(text, 600),
          final_url: res.url,
          cookies: cookieNameList(cookies),
        },
      },
    );
  }

  /** Faz `acoes.php` com o body indicado e regista (com inspeção dos ids). */
  async function callAcoes(
    phaseLabel: string,
    bodyPairs: Record<string, string>,
  ): Promise<{ step: StepRecord; text: string; ok: boolean }> {
    let res: Response;
    const body = new URLSearchParams(bodyPairs).toString();
    try {
      res = await fetch(acoesUrl, {
        method: "POST",
        headers: headersAcoes(cookies, origin, refererIndex),
        body,
        redirect: "follow",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const step = recordStepWithoutUpload(
        `acoes_${phaseLabel}`,
        `POST acoes.php (${phaseLabel})`,
        { status: "fail", message: msg, detalhes: { body } },
      );
      return { step, text: "", ok: false };
    }
    {
      const more = collectSetCookieHeader(res.headers);
      if (more) cookies = mergeCookieStrings(cookies, more);
    }
    const text = await res.text();
    const insight = inspectResponseHtml(text);
    const ct = res.headers.get("Content-Type") ?? "text/html; charset=utf-8";
    const step = await recordStepWithUpload(
      `acoes_${phaseLabel}`,
      `POST acoes.php (${phaseLabel})`,
      `acoes-${phaseLabel}.html`,
      new TextEncoder().encode(text),
      ct.toLowerCase().includes("html") ? "text/html; charset=utf-8" : ct,
      {
        http_status: res.status,
        status: res.ok ? "ok" : "fail",
        message: res.ok ? undefined : `HTTP ${res.status}`,
        detalhes: {
          previa: previewText(text, 800),
          final_url: res.url,
          body,
          ...insight,
        },
      },
    );
    return { step, text, ok: res.ok };
  }

  // --- Fase 1: validadorOz + acoes “vazia” → exige id=ConteudoTela ----------
  const v1 = await callValidador("fase1");
  if (v1.status === "fail") {
    return await failJson(502, v1.message ?? "validadorOz fase1 falhou.");
  }

  const acoes1 = await callAcoes("fase1", {
    modulo: MODULO_REL,
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
    return await failJson(
      502,
      acoes1.step.message ?? "acoes.php (fase1) falhou.",
    );
  }
  if (!hasConteudoTela(acoes1.text)) {
    acoes1.step.status = "fail";
    //acoes1.step.message = "Verifique credenciais, NaoMenu e o módulo configurado.";
    log("conteudo_tela_nao_encontrado", {
      previa: previewText(acoes1.text, 800),
    });
    return await failJson(
      502,
      "Verifique credenciais, NaoMenu e o módulo configurado.",
    );
  }
  recordStepWithoutUpload(
    "validar_conteudo_tela",
    "Verificar id=ConteudoTela na fase1",
    {
      status: "ok",
      message: "id=ConteudoTela presente na resposta da fase 1.",
    },
  );

  // --- Fase 2: janela de dias (consulta diária no EPOC) ----------------------
  let diasConsulta: string[];
  let diasConsultaLabel: string;
  if (manualConsultaDias?.length) {
    diasConsulta = manualConsultaDias;
    diasConsultaLabel =
      diasConsulta.length === 1
        ? `dia ${diasConsulta[0]} (repetição)`
        : `${diasConsulta.length} dia(s) (repetição)`;
  } else if (syncMode === "onboarding_initial") {
    diasConsulta = onboardingEpocConsultaDaysSaoPaulo();
    diasConsultaLabel =
      diasConsulta.length >= 2
        ? `onboarding: ${diasConsulta[0]} → ${diasConsulta[diasConsulta.length - 1]} (America/Sao_Paulo)`
        : diasConsulta.length === 1
          ? `onboarding: ${diasConsulta[0]} (America/Sao_Paulo)`
          : "onboarding (sem dias)";
  } else if (syncMode === "previous_day") {
    diasConsulta = [yesterdayDateBrInTz("America/Sao_Paulo")];
    diasConsultaLabel = "dia anterior (America/Sao_Paulo)";
  } else {
    diasConsulta = lastNDaysBr(10);
    diasConsultaLabel = "últimos 10 dias";
  }
  const headerBase: string[] = [];
  const linhasCsvFinal: string[][] = [];
  /** Índice em `headerBase` da coluna total recebido (-1 se o cabeçalho não trouxer a coluna). */
  let totalRecebidoColIndex = -1;
  let totalDiasComTabela = 0;
  let totalLinhasDados = 0;
  /** Erro textual do próprio portal (ex.: «sem eventos com esse filtro»), por dia consultado. */
  const mensagemPortalPorDiaBr: Record<string, string> = {};

  const BATCH_SIZE = 20;
  for (
    let batchStart = 0;
    batchStart < diasConsulta.length;
    batchStart += BATCH_SIZE
  ) {
    const batchDays = diasConsulta.slice(batchStart, batchStart + BATCH_SIZE);
    recordStepWithoutUpload(
      `fase2_batch_${String(Math.floor(batchStart / BATCH_SIZE) + 1).padStart(2, "0")}`,
      `Consulta paralela de ${batchDays.length} dia(s)`,
      {
        status: "ok",
        message: `Executando ${batchDays.length} requisições em paralelo.`,
        detalhes: { dias: batchDays },
      },
    );

    const batchResults = await Promise.all(
      batchDays.map(async (dia, idx) => {
        const globalIdx = batchStart + idx + 1;
        const suffix = `dia${String(globalIdx).padStart(2, "0")}`;
        const vDia = await callValidador(`fase2_${suffix}`);
        if (vDia.status === "fail") {
          return {
            dia,
            suffix,
            ok: false as const,
            message: "validadorOz falhou; dia ignorado.",
          };
        }

        const acoesDia = await callAcoes(`fase2_${suffix}`, {
          modulo: MODULO_REL,
          NaoMenu: naoMenu,
          token: tokenForBody,
          data_de: dia,
          data_ate: dia,
          busca_grupo_evento: "-1",
          filtrar: "FORM",
        });
        if (!acoesDia.ok) {
          return {
            dia,
            suffix,
            ok: false as const,
            message: "acoes.php falhou; dia ignorado.",
          };
        }

        const htmlDia = unwrapAcoesHtml(acoesDia.text);
        if (!htmlHasId(htmlDia, EPOC_ID_TBL_EXPORT)) {
          const portalMsg = mensagemPortalSemEventosPorFiltro(acoesDia.text);
          return {
            dia,
            suffix,
            ok: false as const,
            message: portalMsg ?? "Sem id=tblExport para este dia.",
            portal_feedback: portalMsg ?? undefined,
          };
        }

        const tableHtml = extractElementOuterHtmlById(
          htmlDia,
          EPOC_ID_TBL_EXPORT,
        );
        if (!tableHtml) {
          return {
            dia,
            suffix,
            ok: false as const,
            message: "tblExport não pôde ser extraída do HTML.",
          };
        }
        const parsed = extractTableHeaderAndRows(tableHtml);
        if (parsed.header.length === 0) {
          return {
            dia,
            suffix,
            ok: false as const,
            message: "Tabela sem cabeçalho legível.",
          };
        }
        return {
          dia,
          suffix,
          ok: true as const,
          parsed,
          tableHtml,
        };
      }),
    );

    for (const result of batchResults) {
      if (!result.ok) {
        const portalFb =
          "portal_feedback" in result && result.portal_feedback
            ? result.portal_feedback
            : null;
        if (portalFb) mensagemPortalPorDiaBr[result.dia] = portalFb;
        recordStepWithoutUpload(
          `fase2_${result.suffix}_resumo`,
          `Resumo consulta diária ${result.dia}`,
          {
            status: "warn",
            message: portalFb ? `${result.dia}: ${portalFb}` : result.message,
            detalhes: {
              dia: result.dia,
              ...(portalFb ? { mensagem_portal_epoc: portalFb } : {}),
            },
          },
        );
        continue;
      }
      if (headerBase.length === 0) {
        headerBase.push(...result.parsed.header);
        totalRecebidoColIndex = findTotalRecebidoColumnIndex(headerBase);
      }
      const targetLen = headerBase.length;
      let linhasDia = 0;
      for (const row of result.parsed.rows) {
        const ajustada = row.slice(0, targetLen);
        while (ajustada.length < targetLen) ajustada.push("");
        if (totalRecebidoColIndex >= 0) {
          const totalCell = ajustada[totalRecebidoColIndex] ?? "";
          if (!isTotalRecebidoCellFilled(totalCell)) continue;
        }
        linhasCsvFinal.push([result.dia, ...ajustada]);
        linhasDia++;
      }
      totalDiasComTabela++;
      totalLinhasDados += linhasDia;
      recordStepWithoutUpload(
        `fase2_${result.suffix}_resumo`,
        `Resumo consulta diária ${result.dia}`,
        {
          status: "ok",
          message: `tblExport encontrada com ${linhasDia} linha(s) de dados.`,
          detalhes: {
            dia: result.dia,
            header_cols: result.parsed.header.length,
            filtro_coluna_total_recebido: totalRecebidoColIndex >= 0,
          },
        },
      );
    }
  }

  if (headerBase.length === 0) {
    const diasComFeedbackPortal = diasConsulta
      .map((d) => {
        const m = mensagemPortalPorDiaBr[d];
        return m ? `${d}: ${m}` : null;
      })
      .filter((x): x is string => x != null);

    let summary: string;
    if (diasConsulta.length === 1) {
      const d0 = diasConsulta[0];
      const mPortal = mensagemPortalPorDiaBr[d0];
      summary = mPortal
        ? `${d0}: ${mPortal}`
        : `Sem dados de receitas no EPOC para o dia ${d0}.`;
    } else if (diasComFeedbackPortal.length > 0) {
      summary = diasComFeedbackPortal.join(" · ");
      if (diasComFeedbackPortal.length < diasConsulta.length) {
        summary +=
          " — demais dias na janela sem mensagem explícita do portal (sem #tblExport).";
      }
    } else {
      summary = `Sem tabela #tblExport no EPOC na janela consultada (${diasConsultaLabel}); não foi possível extrair receitas para importação.`;
    }

    recordStepWithoutUpload("sync_outcome", "Resultado da sincronização EPOC", {
      status: "warn",
      message: summary,
      detalhes: {
        outcome: "no_tbl_export",
        dias: diasConsulta,
        sync_mode: syncMode,
        dias_consulta_label: diasConsultaLabel,
        ...(Object.keys(mensagemPortalPorDiaBr).length > 0
          ? { portal_por_dia: mensagemPortalPorDiaBr }
          : {}),
      },
    });

    let epocCsvSyncRunId: string | null = null;
    const { data: histRow, error: histErr } = await admin
      .from("epoc_csv_sync_runs")
      .insert({
        company_id: companyId,
        requested_by: userIdForJob,
        provider: "epoc",
        sync_mode: syncMode,
        outcome: "no_tbl_export",
        summary,
        dates_consulted: diasConsulta,
        steps_prefix: stepsPrefix,
        metadata: {
          dias_consulta_label: diasConsultaLabel,
          tbl_export_found: false,
          source: "epoc-sync-csv",
          manual_consulta: !!manualConsultaDias?.length,
          ...(Object.keys(mensagemPortalPorDiaBr).length > 0
            ? { portal_por_dia: mensagemPortalPorDiaBr }
            : {}),
        },
      })
      .select("id")
      .maybeSingle();
    if (histErr) {
      log("epoc_csv_sync_runs_insert_falhou", { message: histErr.message });
    } else if (histRow?.id) {
      epocCsvSyncRunId = String(histRow.id);
    }

    await patchOb({
      portal_busy: false,
      portal_outcome: "no_tbl_export",
      portal_message: summary.slice(0, 500),
      sync: false,
    });

    const isDailyPreviousDayOnly =
      syncMode === "previous_day" && !manualConsultaDias?.length;

    if (isDailyPreviousDayOnly) {
      const nowIso = new Date().toISOString();
      const nextSettings: Record<string, unknown> = {
        ...raw,
        epoc_daily_sync_last_attempt_at: nowIso,
        epoc_daily_sync_last_attempt_ok: true,
        epoc_daily_sync_last_attempt_outcome: "no_tbl_export",
        epoc_daily_sync_last_attempt_error: null,
        epoc_daily_sync_last_consulted_day_br: diasConsulta[0] ?? null,
      };
      const { error: upDailyErr } = await admin
        .from("company_integrations")
        .update({
          settings: nextSettings,
          updated_at: nowIso,
        })
        .eq("company_id", companyId)
        .eq("provider", "epoc");
      if (upDailyErr) {
        log("epoc_daily_sync_no_sales_settings_falhou", {
          message: upDailyErr.message,
        });
      }

      return json({
        ok: true,
        outcome: "no_tbl_export",
        message: summary,
        consulted_day_br: diasConsulta[0] ?? null,
        tblExport_found: false,
        dias_consultados: diasConsulta.length,
        epoc_csv_sync_run_id: epocCsvSyncRunId,
        steps_prefix: stepsPrefix,
        steps,
        signed_url_expires_in: signedTtl,
      });
    }

    return await failJson(
      502,
      summary,
      {
        tblExport_found: false,
        dias_consultados: diasConsulta.length,
        epoc_csv_sync_run_id: epocCsvSyncRunId,
        outcome: "no_tbl_export",
      },
      { skipPortalPatch: true },
    );
  }

  // --- CSV final consolidado -------------------------------------------------
  const csvHeader = ["data_consumo", ...headerBase];
  const csvGenerated = matrixToCsv(csvHeader, linhasCsvFinal);
  let csvStoragePath: string | null = null;
  let csvFileName: string | null = null;
  let csvSizeBytes = 0;
  let csvDownloadUrl: string | null = null;

  const csvFileNameFinal =
    manualConsultaDias?.length === 1
      ? `tblExport-replay-${manualConsultaDias[0].replace(/\//g, "-")}.csv`
      : manualConsultaDias?.length
        ? `tblExport-replay-${String(manualConsultaDias.length)}dias.csv`
        : syncMode === "onboarding_initial"
          ? "tblExport-onboarding-inicial.csv"
          : syncMode === "previous_day"
            ? "tblExport-dia-anterior.csv"
            : "tblExport-ultimos-10-dias.csv";
  const csvStepLabel =
    manualConsultaDias?.length === 1
      ? `CSV final (repetição ${manualConsultaDias[0]})`
      : manualConsultaDias?.length
        ? `CSV final (repetição ${manualConsultaDias.length} dia(s))`
        : syncMode === "onboarding_initial"
          ? "CSV onboarding (mês anterior → ontem, SP)"
          : syncMode === "previous_day"
            ? "CSV final (dia anterior)"
            : "CSV final consolidado (últimos 10 dias)";

  const csvOrigemMeta = manualConsultaDias?.length
    ? "table_to_csv_manual_replay"
    : syncMode === "onboarding_initial"
      ? "table_to_csv_onboarding_range_sp"
      : syncMode === "previous_day"
        ? "table_to_csv_previous_day"
        : "table_to_csv_10_days";

  if (csvGenerated.trim().length > 0) {
    const csvStep = await recordStepWithUpload(
      "csv_from_tbl_export",
      csvStepLabel,
      csvFileNameFinal,
      new TextEncoder().encode(csvGenerated),
      "text/csv",
      {
        status: "ok",
        detalhes: {
          origem: csvOrigemMeta,
          dias_consultados: diasConsulta.length,
          dias_com_tabela: totalDiasComTabela,
          linhas_dados: totalLinhasDados,
          linhas_csv_total: csvGenerated.split(/\r?\n/).filter(Boolean).length,
          filtro_total_recebido_coluna_encontrada: totalRecebidoColIndex >= 0,
          previa: previewText(csvGenerated, 800),
        },
      },
    );
    csvStoragePath = csvStep.storage_path ?? null;
    csvFileName = csvStep.file_name ?? null;
    csvSizeBytes = csvStep.bytes ?? 0;
    csvDownloadUrl = csvStep.download_url ?? null;
  } else {
    recordStepWithoutUpload(
      "csv_from_tbl_export",
      "CSV gerado a partir de #tblExport",
      {
        status: "warn",
        message: "CSV consolidado ficou vazio (sem linhas de dados).",
      },
    );
  }

  const nowIso = new Date().toISOString();
  const nextSettings: Record<string, unknown> = {
    ...raw,
  };
  if (csvStoragePath) {
    nextSettings.last_epoc_csv_sync_at = nowIso;
    nextSettings.last_epoc_csv_storage_path = csvStoragePath;
  }
  if (
    csvStoragePath &&
    (syncMode === "previous_day" || manualConsultaDias?.length)
  ) {
    nextSettings.epoc_daily_sync_last_attempt_at = nowIso;
    nextSettings.epoc_daily_sync_last_attempt_ok = true;
    nextSettings.epoc_daily_sync_last_attempt_outcome = "success";
    nextSettings.epoc_daily_sync_last_attempt_error = null;
    nextSettings.epoc_daily_sync_last_consulted_day_br = null;
  }

  const { error: upIntegErr } = await admin
    .from("company_integrations")
    .update({
      settings: nextSettings,
      updated_at: nowIso,
    })
    .eq("company_id", companyId)
    .eq("provider", "epoc");
  if (upIntegErr) {
    log("settings_falha", { message: upIntegErr.message });
    return await failJson(
      500,
      `Conteúdo salvo no Storage, mas metadados não atualizados: ${upIntegErr.message}.`,
      {},
    );
  }

  let csvRevenueImportJobId: string | null = null;
  if (csvStoragePath) {
    const { data: jobIns, error: jobErr } = await admin
      .from("integration_csv_revenue_import_jobs")
      .insert({
        company_id: companyId,
        requested_by: userIdForJob,
        provider: "epoc",
        storage_bucket: "company-setup",
        storage_path: csvStoragePath,
        status: "PENDING",
        metadata: {
          steps_prefix: stepsPrefix,
          source: "epoc-sync-csv",
          sync_mode: syncMode,
          ...(manualConsultaDias?.length
            ? { consulta_dias_br: manualConsultaDias }
            : {}),
        },
      })
      .select("id")
      .maybeSingle();
    if (jobErr) {
      log("csv_revenue_job_enqueue_falhou", { message: jobErr.message });
    } else if (jobIns?.id) {
      csvRevenueImportJobId = String(jobIns.id);
      scheduleProcessCsvRevenueJob(
        supabaseUrl,
        serviceKey,
        anonKey,
        csvRevenueImportJobId,
      );
      log("csv_revenue_job_disparado", { job_id: csvRevenueImportJobId });
    }
  }

  await patchOb({
    portal_busy: false,
    portal_outcome: "success",
    portal_message: null,
    import_status: csvRevenueImportJobId ? "pending" : null,
  });

  log("concluido", {
    steps: steps.length,
    csv_revenue_import_job_id: csvRevenueImportJobId,
  });

  return json({
    ok: true,
    steps_prefix: stepsPrefix,
    steps,
    tblExport_found: true,
    csv_uploaded: !!csvStoragePath,
    storage_path: csvStoragePath,
    file_name: csvFileName,
    size_bytes: csvSizeBytes,
    download_url: csvDownloadUrl,
    signed_url_expires_in: signedTtl,
    /** Job para fila + Database Webhook → `process-integration-csv-revenue-job`. */
    csv_revenue_import_job_id: csvRevenueImportJobId,
  });
});

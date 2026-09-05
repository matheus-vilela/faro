/**
 * EPOC: cada etapa do portal é guardada e disponibilizada no Storage como `step` para
 * download e inspeção (login → index → validadorOz/acoes fase1 → validadorOz/acoes fase2).
 * Cada step traz: bytes, content-type, http_status, presença de ids relevantes
 * (`ConteudoTela`, `tblExport`) e URL assinada. O sucesso só é declarado quando a
 * fase 2 contém `id=tblExport`; mesmo no erro o JSON inclui o trace com as URLs.
 *
 * Janelas longas (onboarding / multi-dia): processa `max_days` (default 3) por
 * invocação, grava CSV parcial no Storage e auto-chama-se (`continue_chain`) até
 * concluir — evita idle timeout ~150s. No fim faz merge, enfileira import e dispara
 * serviços/faturamento async.
 *
 * O CSV consolidado inclui apenas linhas de dados com a coluna "Total Bruto(R$)"
 * preenchida (célula não vazia após trim), quando essa coluna existir no cabeçalho.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { userHasCompanyAccess } from "../_shared/companyAccess.ts";
import {
  buildEpocSyncFlowDiagnostic,
  type EpocFlowDiagnostic,
} from "../_shared/epocFlowDiagnostic.ts";
import {
  fetchEpocPortalPostWithRetry,
  redactEpocFormBody,
} from "../_shared/epocPortalFetch.ts";
import { performEpocPortalLogin } from "../_shared/epocPortalLoginSession.ts";
import { humanizeEpocRemoteError } from "../_shared/epocRemoteErrorMessage.ts";
import { enqueueAndTriggerEpocCsvImport } from "../_shared/enqueueEpocCsvRevenueImportJob.ts";
import { epocEstoqueFiltrarAcoesBody } from "../_shared/epocEstoqueCsv.ts";
import { extractSoldProdutoKeys } from "../_shared/epocProdutoSinteticoCsv.ts";
import {
  buildPartialSyncSummary,
  listEpocSyncGaps,
  persistEstoqueVariantOutsFromAcoesHtml,
  upsertEpocSyncDayStatus,
} from "../_shared/epocPersistDailyExtras.ts";
import { brDateToIso } from "../_shared/epocPtBrNumber.ts";
import {
  isOnboardingPdvSyncInProgress,
  patchOnboardingPdv,
  type OnboardingPdvPatch,
} from "../_shared/onboardingPdvPatch.ts";
import { triggerEpocDailyExtrasInBackground } from "../_shared/triggerEpocDailyExtras.ts";
import {
  triggerEpocSyncCsvContinueInBackground,
  type EpocSyncCsvContinuePayload,
} from "../_shared/triggerEpocSyncCsvContinue.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOG = "[epoc-sync-csv]";

/** Dias processados por invocação (evita idle timeout ~150s). */
const DEFAULT_MAX_DAYS_PER_INVOKE = 3;
const MAX_DAYS_PER_INVOKE_CAP = 5;
/** Limite de elos da cadeia (ex.: 60×3 ≈ 180 dias). */
const MAX_PRODUCT_CHAIN_ATTEMPTS = 60;
const PRODUCT_CHAIN_SETTINGS_KEY = "epoc_product_csv_chain";

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
const COL_TOTAL_BRUTO = "Total Bruto(R$)";

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

function findTotalBrutoColumnIndex(headers: string[]): number {
  const want = normalizeHeaderLabel(COL_TOTAL_BRUTO);
  for (let i = 0; i < headers.length; i++) {
    if (normalizeHeaderLabel(headers[i] ?? "") === want) return i;
  }
  for (let i = 0; i < headers.length; i++) {
    const h = normalizeHeaderLabel(headers[i] ?? "");
    if (h.includes("totalbruto")) return i;
  }
  return -1;
}

/** Valor “preenchido” para o CSV: não vazio após trim (NBSP / zero-width removidos). */
function isTotalBrutoCellFilled(raw: string): boolean {
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

/** Junta partes CSV (1.ª com cabeçalho; restantes saltam a 1.ª linha). */
function mergeCsvPartTexts(parts: string[]): string {
  const nonEmpty = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  if (nonEmpty.length === 0) return "";
  let out = nonEmpty[0];
  for (let i = 1; i < nonEmpty.length; i++) {
    const lines = nonEmpty[i].split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length <= 1) continue;
    out = `${out.replace(/\s+$/, "")}\n${lines.slice(1).join("\n")}`;
  }
  return out.endsWith("\n") ? out : `${out}\n`;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

type ProductCsvChainState = {
  run_id: string;
  status: "fetching" | "done" | "failed";
  sync_mode: string;
  steps_prefix: string;
  dias_planned: string[];
  dias_done: string[];
  part_paths: string[];
  header_base: string[];
  total_dias_com_tabela: number;
  total_linhas_dados: number;
  requested_by: string;
  chain_attempt: number;
  consulta_dias_br?: string[] | null;
  updated_at: string;
  last_error?: string | null;
};

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
    continue_chain?: unknown;
    chain_attempt?: unknown;
    max_days?: unknown;
    product_sync_run_id?: unknown;
    steps_prefix?: unknown;
    dias_planned_br?: unknown;
    dias_done_br?: unknown;
    part_paths?: unknown;
    header_base?: unknown;
    total_dias_com_tabela?: unknown;
    total_linhas_dados?: unknown;
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

  const continueChainReq = body.continue_chain === true;
  const chainAttemptRaw =
    typeof body.chain_attempt === "number" && Number.isFinite(body.chain_attempt)
      ? Math.floor(body.chain_attempt)
      : 0;
  const chainAttempt = Math.max(0, chainAttemptRaw);
  const maxDaysRaw =
    typeof body.max_days === "number" && Number.isFinite(body.max_days)
      ? Math.floor(body.max_days)
      : DEFAULT_MAX_DAYS_PER_INVOKE;
  const maxDaysPerInvoke = Math.min(
    MAX_DAYS_PER_INVOKE_CAP,
    Math.max(1, maxDaysRaw),
  );
  const bodyProductSyncRunId =
    typeof body.product_sync_run_id === "string"
      ? body.product_sync_run_id.trim()
      : "";
  const bodyStepsPrefix =
    typeof body.steps_prefix === "string" ? body.steps_prefix.trim() : "";
  const bodyDiasPlanned = asStringArray(body.dias_planned_br);
  const bodyDiasDone = asStringArray(body.dias_done_br);
  const bodyPartPaths = asStringArray(body.part_paths);
  const bodyHeaderBase = asStringArray(body.header_base);
  const bodyTotalDiasComTabela =
    typeof body.total_dias_com_tabela === "number" &&
      Number.isFinite(body.total_dias_com_tabela)
      ? Math.max(0, Math.floor(body.total_dias_com_tabela))
      : 0;
  const bodyTotalLinhasDados =
    typeof body.total_linhas_dados === "number" &&
      Number.isFinite(body.total_linhas_dados)
      ? Math.max(0, Math.floor(body.total_linhas_dados))
      : 0;

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
      if (!(await userHasCompanyAccess(admin, rbRaw, companyId))) {
        return json(
          { ok: false, error: "requested_by sem acesso a esta unidade" },
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
        // Sem membros: usa qualquer admin global como requested_by (FK auth.users).
        const { data: adm } = await admin
          .from("profiles")
          .select("id")
          .eq("is_admin", true)
          .limit(1)
          .maybeSingle();
        if (!adm?.id) {
          return json(
            {
              ok: false,
              error:
                "Unidade sem utilizador em user_companies e sem admin global",
            },
            400,
          );
        }
        userIdForJob = adm.id as string;
      } else {
        userIdForJob = picked;
      }
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

    if (!(await userHasCompanyAccess(admin, user.id, companyId))) {
      return json({ ok: false, error: "Sem acesso a esta unidade" }, 403);
    }

    const integRes = await admin
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
  let stepsPrefix =
    continueChainReq && bodyStepsPrefix
      ? bodyStepsPrefix.endsWith("/")
        ? bodyStepsPrefix
        : `${bodyStepsPrefix}/`
      : `${companyId}/epoc-sync/${fileStamp}/`;
  const signedTtl = 60 * 60;
  const steps: StepRecord[] = [];

  async function persistProductCsvChain(
    state: ProductCsvChainState | null,
  ): Promise<void> {
    const { data: fresh } = await admin
      .from("company_integrations")
      .select("settings")
      .eq("company_id", companyId)
      .eq("provider", "epoc")
      .maybeSingle();
    const base =
      (fresh?.settings as Record<string, unknown> | null) ??
      (raw as Record<string, unknown>);
    const next: Record<string, unknown> = { ...base };
    if (state == null) {
      delete next[PRODUCT_CHAIN_SETTINGS_KEY];
    } else {
      next[PRODUCT_CHAIN_SETTINGS_KEY] = state;
    }
    await admin
      .from("company_integrations")
      .update({
        settings: next,
        updated_at: new Date().toISOString(),
      })
      .eq("company_id", companyId)
      .eq("provider", "epoc");
  }

  function readStoredProductChain(): ProductCsvChainState | null {
    const v = raw[PRODUCT_CHAIN_SETTINGS_KEY];
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    const runId = typeof o.run_id === "string" ? o.run_id.trim() : "";
    const status = o.status;
    if (!runId || (status !== "fetching" && status !== "done" && status !== "failed")) {
      return null;
    }
    return {
      run_id: runId,
      status,
      sync_mode: typeof o.sync_mode === "string" ? o.sync_mode : syncMode,
      steps_prefix:
        typeof o.steps_prefix === "string" ? o.steps_prefix : stepsPrefix,
      dias_planned: asStringArray(o.dias_planned),
      dias_done: asStringArray(o.dias_done),
      part_paths: asStringArray(o.part_paths),
      header_base: asStringArray(o.header_base),
      total_dias_com_tabela:
        typeof o.total_dias_com_tabela === "number"
          ? Math.max(0, Math.floor(o.total_dias_com_tabela))
          : 0,
      total_linhas_dados:
        typeof o.total_linhas_dados === "number"
          ? Math.max(0, Math.floor(o.total_linhas_dados))
          : 0,
      requested_by:
        typeof o.requested_by === "string" ? o.requested_by : userIdForJob,
      chain_attempt:
        typeof o.chain_attempt === "number"
          ? Math.max(0, Math.floor(o.chain_attempt))
          : 0,
      consulta_dias_br: asStringArray(o.consulta_dias_br),
      updated_at:
        typeof o.updated_at === "string"
          ? o.updated_at
          : new Date().toISOString(),
      last_error: typeof o.last_error === "string" ? o.last_error : null,
    };
  }

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

  async function recordEpocCsvSyncRun(input: {
    outcome: "no_tbl_export" | "success" | "failed";
    summary: string;
    datesConsulted?: string[];
    metadata?: Record<string, unknown>;
    flowDiagnostic: EpocFlowDiagnostic;
  }): Promise<string | null> {
    const { data: histRow, error: histErr } = await admin
      .from("epoc_csv_sync_runs")
      .insert({
        company_id: companyId,
        requested_by: userIdForJob,
        provider: "epoc",
        sync_mode: syncMode,
        outcome: input.outcome,
        summary: input.summary,
        dates_consulted: input.datesConsulted ?? [],
        steps_prefix: stepsPrefix,
        metadata: {
          source: "epoc-sync-csv",
          flow_diagnostic: input.flowDiagnostic,
          ...(input.metadata ?? {}),
        },
      })
      .select("id")
      .maybeSingle();
    if (histErr) {
      log("epoc_csv_sync_runs_insert_falhou", { message: histErr.message });
      return null;
    }
    return histRow?.id ? String(histRow.id) : null;
  }

  async function failJson(
    httpStatus: number,
    error: string,
    extras: Record<string, unknown> = {},
    opts?: {
      skipPortalPatch?: boolean;
      flowDiagnostic?: EpocFlowDiagnostic;
      syncRun?: {
        outcome: "failed";
        summary: string;
        datesConsulted?: string[];
        metadata?: Record<string, unknown>;
      };
    },
  ): Promise<Response> {
    const friendlyError = humanizeEpocRemoteError(error);
    const flowDiagnostic =
      opts?.flowDiagnostic ??
      buildEpocSyncFlowDiagnostic({
        loginOk: steps.some((s) => s.name === "login" && s.status === "ok"),
        syncOk: false,
        syncError: friendlyError,
      });
    let epocCsvSyncRunId: string | null = null;
    if (opts?.syncRun) {
      epocCsvSyncRunId = await recordEpocCsvSyncRun({
        outcome: opts.syncRun.outcome,
        summary: opts.syncRun.summary,
        datesConsulted: opts.syncRun.datesConsulted,
        metadata: opts.syncRun.metadata,
        flowDiagnostic,
      });
    }
    try {
      await persistProductCsvChain(null);
    } catch {
      /* ignore */
    }
    if (!opts?.skipPortalPatch) {
      await patchOb({
        portal_busy: false,
        portal_outcome: "failed",
        portal_message: friendlyError.slice(0, 500),
        sync: false,
      });
    }
    return json(
      {
        ok: false,
        error: friendlyError,
        flow_diagnostic: flowDiagnostic,
        steps_prefix: stepsPrefix,
        steps,
        signed_url_expires_in: signedTtl,
        ...(epocCsvSyncRunId ? { epoc_csv_sync_run_id: epocCsvSyncRunId } : {}),
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
    const flowDiagnostic = buildEpocSyncFlowDiagnostic({
      loginOk: false,
      loginError: loginResult.message,
    });
    return await failJson(
      502,
      loginResult.message,
      { epoc_error_code: loginResult.errorCode },
      {
        flowDiagnostic,
        syncRun: {
          outcome: "failed",
          summary: loginResult.message,
        },
      },
    );
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
  const refererValidador = validadorOzUrl;
  const validadorBody = new URLSearchParams({
    NaoMenu: naoMenu,
    token: tokenForBody,
  }).toString();

  /** Renova sessão no portal antes de repetir `acoes.php`. */
  async function refreshValidadorSession(phaseLabel: string): Promise<void> {
    try {
      const fetched = await fetchEpocPortalPostWithRetry(
        validadorOzUrl,
        {
          method: "POST",
          headers: headersValidador(cookies, origin, refererIndex),
          body: validadorBody,
          redirect: "follow",
        },
        {
          label: `validadorOz.php (refresh ${phaseLabel})`,
          attempts: 2,
          baseDelayMs: 400,
          log,
        },
      );
      const more = collectSetCookieHeader(fetched.response.headers);
      if (more) cookies = mergeCookieStrings(cookies, more);
    } catch (e) {
      log("validador_refresh_falhou", {
        phase: phaseLabel,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** Faz `validadorOz.php` e regista resposta. */
  async function callValidador(phaseLabel: string): Promise<StepRecord> {
    let res: Response;
    let text: string;
    try {
      const fetched = await fetchEpocPortalPostWithRetry(
        validadorOzUrl,
        {
          method: "POST",
          headers: headersValidador(cookies, origin, refererIndex),
          body: validadorBody,
          redirect: "follow",
        },
        {
          label: `validadorOz.php (${phaseLabel})`,
          log,
        },
      );
      res = fetched.response;
      text = fetched.text;
    } catch (e) {
      const msg = humanizeEpocRemoteError(
        e instanceof Error ? e.message : String(e),
      );
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
    let text: string;
    const body = new URLSearchParams(bodyPairs).toString();
    try {
      const fetched = await fetchEpocPortalPostWithRetry(
        acoesUrl,
        {
          method: "POST",
          headers: headersAcoes(cookies, origin, refererValidador),
          body,
          redirect: "follow",
        },
        {
          label: `acoes.php (${phaseLabel})`,
          log,
          attempts: 5,
          baseDelayMs: 1200,
          onBeforeRetry: async (nextAttempt) => {
            log("acoes_retry_refresh_validador", {
              phase: phaseLabel,
              next_attempt: nextAttempt,
            });
            await refreshValidadorSession(phaseLabel);
          },
        },
      );
      res = fetched.response;
      text = fetched.text;
    } catch (e) {
      const msg = humanizeEpocRemoteError(
        e instanceof Error ? e.message : String(e),
      );
      const step = recordStepWithoutUpload(
        `acoes_${phaseLabel}`,
        `POST acoes.php (${phaseLabel})`,
        {
          status: "fail",
          message: msg,
          detalhes: { body: redactEpocFormBody(body) },
        },
      );
      return { step, text: "", ok: false };
    }
    {
      const more = collectSetCookieHeader(res.headers);
      if (more) cookies = mergeCookieStrings(cookies, more);
    }
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
          body: redactEpocFormBody(body),
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
    const flowDiagnostic = buildEpocSyncFlowDiagnostic({
      loginOk: true,
      conteudoTelaOk: false,
    });
    return await failJson(
      502,
      "Verifique credenciais, NaoMenu e o módulo configurado.",
      {},
      {
        flowDiagnostic,
        syncRun: {
          outcome: "failed",
          summary:
            "Portal respondeu, mas o módulo de relatório não carregou (sem ConteudoTela).",
        },
      },
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
  // Serviços/faturamento correm depois, em `epoc-retry-daily-extras` (evita idle timeout 150s).
  // Produtos: lotes de `max_days` + auto-chamada (`continue_chain`) para não estourar o timeout.
  let diasPlanned: string[];
  let diasConsultaLabel: string;
  let productSyncRunId: string;
  let diasDonePrior: string[] = [];
  let partPaths: string[] = [];
  let priorHeaderBase: string[] = [];
  let accumulatedDiasComTabela = 0;
  let accumulatedLinhasDados = 0;
  let chainAttemptEffective = chainAttempt;

  const storedChain = readStoredProductChain();

  if (continueChainReq) {
    const fromBody = bodyDiasPlanned.length > 0;
    const fromStore =
      !fromBody &&
      storedChain?.status === "fetching" &&
      storedChain.dias_planned.length > 0;
    if (!fromBody && !fromStore) {
      return json(
        {
          ok: false,
          error:
            "continue_chain sem dias_planned_br (nem estado epoc_product_csv_chain).",
        },
        400,
      );
    }
    if (fromBody) {
      diasPlanned = bodyDiasPlanned;
      diasDonePrior = bodyDiasDone;
      partPaths = [...bodyPartPaths];
      priorHeaderBase = [...bodyHeaderBase];
      accumulatedDiasComTabela = bodyTotalDiasComTabela;
      accumulatedLinhasDados = bodyTotalLinhasDados;
      productSyncRunId = bodyProductSyncRunId || storedChain?.run_id ||
        crypto.randomUUID();
      if (bodyStepsPrefix) {
        stepsPrefix = bodyStepsPrefix.endsWith("/")
          ? bodyStepsPrefix
          : `${bodyStepsPrefix}/`;
      } else if (storedChain?.steps_prefix) {
        stepsPrefix = storedChain.steps_prefix.endsWith("/")
          ? storedChain.steps_prefix
          : `${storedChain.steps_prefix}/`;
      }
    } else {
      const sc = storedChain!;
      diasPlanned = sc.dias_planned;
      diasDonePrior = sc.dias_done;
      partPaths = [...sc.part_paths];
      priorHeaderBase = [...sc.header_base];
      accumulatedDiasComTabela = sc.total_dias_com_tabela;
      accumulatedLinhasDados = sc.total_linhas_dados;
      productSyncRunId = sc.run_id;
      chainAttemptEffective = Math.max(chainAttempt, sc.chain_attempt);
      stepsPrefix = sc.steps_prefix.endsWith("/")
        ? sc.steps_prefix
        : `${sc.steps_prefix}/`;
    }
    diasConsultaLabel =
      diasPlanned.length >= 2
        ? `cadeia produtos: ${diasPlanned[0]} → ${diasPlanned[diasPlanned.length - 1]} (${diasDonePrior.length}/${diasPlanned.length} feitos)`
        : diasPlanned.length === 1
          ? `cadeia produtos: ${diasPlanned[0]}`
          : "cadeia produtos (sem dias)";
  } else if (
    storedChain?.status === "fetching" &&
    syncMode !== "previous_day" &&
    storedChain.sync_mode === syncMode &&
    storedChain.dias_planned.length > 0 &&
    (storedChain.dias_done.length > 0 || storedChain.chain_attempt > 0)
  ) {
    // Fallback: retoma cadeia interrompida (trigger falhou / cold start).
    const ageMs = Date.now() - Date.parse(storedChain.updated_at || "");
    const stale = !Number.isFinite(ageMs) || ageMs > 3 * 60 * 60 * 1000;
    if (!stale) {
      log("product_chain_resume_from_settings", {
        company_id: companyId,
        run_id: storedChain.run_id,
        done: storedChain.dias_done.length,
        planned: storedChain.dias_planned.length,
        age_ms: ageMs,
      });
      diasPlanned = storedChain.dias_planned;
      diasDonePrior = storedChain.dias_done;
      partPaths = [...storedChain.part_paths];
      priorHeaderBase = [...storedChain.header_base];
      accumulatedDiasComTabela = storedChain.total_dias_com_tabela;
      accumulatedLinhasDados = storedChain.total_linhas_dados;
      productSyncRunId = storedChain.run_id;
      chainAttemptEffective = storedChain.chain_attempt;
      stepsPrefix = storedChain.steps_prefix.endsWith("/")
        ? storedChain.steps_prefix
        : `${storedChain.steps_prefix}/`;
      diasConsultaLabel =
        `retoma cadeia produtos (${diasDonePrior.length}/${diasPlanned.length})`;
    } else {
      await persistProductCsvChain(null);
      if (manualConsultaDias?.length) {
        diasPlanned = manualConsultaDias;
        diasConsultaLabel =
          diasPlanned.length === 1
            ? `dia ${diasPlanned[0]} (repetição)`
            : `${diasPlanned.length} dia(s) (repetição)`;
      } else if (syncMode === "onboarding_initial") {
        diasPlanned = onboardingEpocConsultaDaysSaoPaulo();
        diasConsultaLabel =
          diasPlanned.length >= 2
            ? `onboarding: ${diasPlanned[0]} → ${diasPlanned[diasPlanned.length - 1]} (America/Sao_Paulo)`
            : diasPlanned.length === 1
              ? `onboarding: ${diasPlanned[0]} (America/Sao_Paulo)`
              : "onboarding (sem dias)";
      } else if (syncMode === "previous_day") {
        diasPlanned = [yesterdayDateBrInTz("America/Sao_Paulo")];
        diasConsultaLabel = "dia anterior (America/Sao_Paulo)";
      } else {
        diasPlanned = lastNDaysBr(10);
        diasConsultaLabel = "últimos 10 dias";
      }
      productSyncRunId = crypto.randomUUID();
    }
  } else {
    if (manualConsultaDias?.length) {
      diasPlanned = manualConsultaDias;
      diasConsultaLabel =
        diasPlanned.length === 1
          ? `dia ${diasPlanned[0]} (repetição)`
          : `${diasPlanned.length} dia(s) (repetição)`;
    } else if (syncMode === "onboarding_initial") {
      diasPlanned = onboardingEpocConsultaDaysSaoPaulo();
      diasConsultaLabel =
        diasPlanned.length >= 2
          ? `onboarding: ${diasPlanned[0]} → ${diasPlanned[diasPlanned.length - 1]} (America/Sao_Paulo)`
          : diasPlanned.length === 1
            ? `onboarding: ${diasPlanned[0]} (America/Sao_Paulo)`
            : "onboarding (sem dias)";
    } else if (syncMode === "previous_day") {
      diasPlanned = [yesterdayDateBrInTz("America/Sao_Paulo")];
      diasConsultaLabel = "dia anterior (America/Sao_Paulo)";
    } else {
      diasPlanned = lastNDaysBr(10);
      diasConsultaLabel = "últimos 10 dias";
    }
    productSyncRunId = crypto.randomUUID();
    if (storedChain) {
      await persistProductCsvChain(null);
    }
  }

  const pendingDays = diasPlanned.filter((d) => !diasDonePrior.includes(d));
  const diasConsulta = pendingDays.slice(0, maxDaysPerInvoke);
  const willContinueAfterChunk = pendingDays.length > diasConsulta.length;
  const chainingMode =
    willContinueAfterChunk ||
    diasDonePrior.length > 0 ||
    partPaths.length > 0 ||
    diasPlanned.length > maxDaysPerInvoke;

  if (willContinueAfterChunk && chainAttemptEffective >= MAX_PRODUCT_CHAIN_ATTEMPTS) {
    await persistProductCsvChain({
      run_id: productSyncRunId,
      status: "failed",
      sync_mode: syncMode,
      steps_prefix: stepsPrefix,
      dias_planned: diasPlanned,
      dias_done: diasDonePrior,
      part_paths: partPaths,
      header_base: priorHeaderBase,
      total_dias_com_tabela: accumulatedDiasComTabela,
      total_linhas_dados: accumulatedLinhasDados,
      requested_by: userIdForJob,
      chain_attempt: chainAttemptEffective,
      consulta_dias_br: manualConsultaDias,
      updated_at: new Date().toISOString(),
      last_error: "Limite de elos da cadeia de produtos atingido",
    });
    return await failJson(
      504,
      "O download do CSV de produtos excedeu o número máximo de lotes. Tente novamente.",
      {
        product_sync_run_id: productSyncRunId,
        chain_attempt: chainAttemptEffective,
        days_done: diasDonePrior.length,
        days_planned: diasPlanned.length,
      },
    );
  }

  const headerBase: string[] = [...priorHeaderBase];
  const linhasCsvFinal: string[][] = [];
  /** Índice em `headerBase` da coluna total bruto (-1 se o cabeçalho não trouxer a coluna). */
  let totalBrutoColIndex =
    headerBase.length > 0 ? findTotalBrutoColumnIndex(headerBase) : -1;
  let totalDiasComTabela = accumulatedDiasComTabela;
  let totalLinhasDados = accumulatedLinhasDados;
  /** Erro textual do próprio portal (ex.: «sem eventos com esse filtro»), por dia consultado. */
  const mensagemPortalPorDiaBr: Record<string, string> = {};

  log("fase2_chunk", {
    company_id: companyId,
    product_sync_run_id: productSyncRunId,
    chain_attempt: chainAttemptEffective,
    planned: diasPlanned.length,
    done_prior: diasDonePrior.length,
    chunk: diasConsulta.length,
    will_continue: willContinueAfterChunk,
    chaining_mode: chainingMode,
  });

  const BATCH_SIZE = maxDaysPerInvoke;
  for (
    let batchStart = 0;
    batchStart < diasConsulta.length;
    batchStart += BATCH_SIZE
  ) {
    const batchDays = diasConsulta.slice(batchStart, batchStart + BATCH_SIZE);
    const batchOrdinal =
      Math.floor(diasDonePrior.length / Math.max(1, maxDaysPerInvoke)) +
      Math.floor(batchStart / BATCH_SIZE) +
      1;
    recordStepWithoutUpload(
      `fase2_batch_${String(batchOrdinal).padStart(2, "0")}`,
      `Consulta paralela de ${batchDays.length} dia(s) (lote ${batchOrdinal})`,
      {
        status: "ok",
        message: `Executando ${batchDays.length} requisições em paralelo.`,
        detalhes: {
          dias: batchDays,
          product_sync_run_id: productSyncRunId,
          chain_attempt: chainAttemptEffective,
        },
      },
    );

    const batchResults = await Promise.all(
      batchDays.map(async (dia, idx) => {
        const globalIdx = diasDonePrior.length + batchStart + idx + 1;
        const suffix = `dia${String(globalIdx).padStart(2, "0")}`;
        const vDia = await callValidador(`fase2_${suffix}`);
        if (vDia.status === "fail") {
          return {
            dia,
            suffix,
            ok: false as const,
            message: "validadorOz falhou; dia ignorado.",
            estoqueHtml: null,
          };
        }

        const [acoesDia, acoesEstoque] = await Promise.all([
          callAcoes(`fase2_${suffix}`, {
            modulo: MODULO_REL,
            NaoMenu: naoMenu,
            token: tokenForBody,
            data_de: dia,
            data_ate: dia,
            busca_grupo_evento: "-1",
            filtrar: "FORM",
          }),
          callAcoes(
            `fase2_${suffix}_estoque`,
            epocEstoqueFiltrarAcoesBody(dia, naoMenu, tokenForBody),
          ),
        ]);
        if (!acoesDia.ok) {
          return {
            dia,
            suffix,
            ok: false as const,
            message: "acoes.php falhou; dia ignorado.",
            estoqueHtml: acoesEstoque.ok ? acoesEstoque.text : null,
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
            estoqueHtml: acoesEstoque.ok ? acoesEstoque.text : null,
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
            estoqueHtml: acoesEstoque.ok ? acoesEstoque.text : null,
          };
        }
        const parsed = extractTableHeaderAndRows(tableHtml);
        if (parsed.header.length === 0) {
          return {
            dia,
            suffix,
            ok: false as const,
            message: "Tabela sem cabeçalho legível.",
            estoqueHtml: acoesEstoque.ok ? acoesEstoque.text : null,
          };
        }
        return {
          dia,
          suffix,
          ok: true as const,
          parsed,
          tableHtml,
          estoqueHtml: acoesEstoque.ok ? acoesEstoque.text : null,
        };
      }),
    );

    for (const result of batchResults) {
      const saleDateIso = brDateToIso(result.dia);
      if (saleDateIso) {
        // Venda de produtos + estoque neste request; serviços/faturamento ficam no extras.
        await upsertEpocSyncDayStatus(admin, companyId, saleDateIso, {
          products_ok: result.ok,
          products_error: result.ok
            ? null
            : (result.message ?? "produtos sem dados"),
          services_ok: false,
          faturamento_ok: false,
          services_error: "pendente (sync async)",
          faturamento_error: "pendente (sync async)",
        });
        if (result.estoqueHtml) {
          try {
            const soldItems = result.ok
              ? extractSoldProdutoKeys(result.parsed.header, result.parsed.rows)
              : [];
            await persistEstoqueVariantOutsFromAcoesHtml(
              admin,
              companyId,
              result.dia,
              result.estoqueHtml,
              soldItems,
            );
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`${LOG} persist estoque`, saleDateIso, msg);
            await upsertEpocSyncDayStatus(admin, companyId, saleDateIso, {
              stock_ok: false,
              stock_error: msg,
            });
          }
        } else {
          await upsertEpocSyncDayStatus(admin, companyId, saleDateIso, {
            stock_ok: false,
            stock_error: "estoque não veio no mesmo ciclo da venda",
          });
        }
      }

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
        totalBrutoColIndex = findTotalBrutoColumnIndex(headerBase);
      }
      const targetLen = headerBase.length;
      let linhasDia = 0;
      for (const row of result.parsed.rows) {
        const ajustada = row.slice(0, targetLen);
        while (ajustada.length < targetLen) ajustada.push("");
        if (totalBrutoColIndex >= 0) {
          const totalCell = ajustada[totalBrutoColIndex] ?? "";
          if (!isTotalBrutoCellFilled(totalCell)) continue;
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
            filtro_coluna_total_bruto: totalBrutoColIndex >= 0,
          },
        },
      );
    }
  }

  const diasDoneNext = [...diasDonePrior, ...diasConsulta];

  let chunkPartUploaded = false;
  if (chainingMode && headerBase.length > 0 && linhasCsvFinal.length > 0) {
    const partCsv = matrixToCsv(["data_consumo", ...headerBase], linhasCsvFinal);
    const partFileName =
      `part-chunk-${String(chainAttemptEffective).padStart(2, "0")}.csv`;
    const partStep = await recordStepWithUpload(
      `csv_part_chunk_${String(chainAttemptEffective).padStart(2, "0")}`,
      `CSV parcial produtos (lote ${chainAttemptEffective + 1})`,
      partFileName,
      new TextEncoder().encode(partCsv),
      "text/csv",
      {
        status: "ok",
        detalhes: {
          linhas: linhasCsvFinal.length,
          dias_chunk: diasConsulta,
          product_sync_run_id: productSyncRunId,
        },
      },
    );
    if (partStep.storage_path) {
      partPaths.push(partStep.storage_path);
      chunkPartUploaded = true;
    } else {
      log("csv_part_upload_falhou", {
        company_id: companyId,
        chain_attempt: chainAttemptEffective,
        detalhes: partStep.detalhes,
      });
    }
  }

  const chainStateNow: ProductCsvChainState = {
    run_id: productSyncRunId,
    status: willContinueAfterChunk ? "fetching" : "done",
    sync_mode: syncMode,
    steps_prefix: stepsPrefix,
    dias_planned: diasPlanned,
    dias_done: diasDoneNext,
    part_paths: partPaths,
    header_base: headerBase,
    total_dias_com_tabela: totalDiasComTabela,
    total_linhas_dados: totalLinhasDados,
    requested_by: userIdForJob,
    chain_attempt: chainAttemptEffective,
    consulta_dias_br: manualConsultaDias,
    updated_at: new Date().toISOString(),
    last_error: null,
  };

  if (
    willContinueAfterChunk &&
    linhasCsvFinal.length > 0 &&
    !chunkPartUploaded
  ) {
    await persistProductCsvChain({
      ...chainStateNow,
      dias_done: diasDonePrior,
      status: "fetching",
      last_error: "Falha ao gravar CSV parcial do lote",
    });
    return await failJson(
      500,
      "Falha ao gravar o lote parcial do CSV no Storage. Tente novamente — o progresso anterior será retomado.",
      {
        product_sync_run_id: productSyncRunId,
        chain_attempt: chainAttemptEffective,
        days_done: diasDonePrior.length,
        days_planned: diasPlanned.length,
      },
    );
  }

  await persistProductCsvChain(
    willContinueAfterChunk || chainingMode ? chainStateNow : null,
  );

  if (willContinueAfterChunk) {
    const progressMsg =
      `A buscar vendas no EPOC (${diasDoneNext.length}/${diasPlanned.length} dias)…`;
    await patchOb({
      portal_busy: true,
      portal_outcome: null,
      portal_message: progressMsg,
      sync: true,
      import_error: null,
    });

    const continuePayload: EpocSyncCsvContinuePayload = {
      company_id: companyId,
      sync_mode: syncMode,
      continue_chain: true,
      chain_attempt: chainAttemptEffective + 1,
      max_days: maxDaysPerInvoke,
      product_sync_run_id: productSyncRunId,
      steps_prefix: stepsPrefix,
      dias_planned_br: diasPlanned,
      dias_done_br: diasDoneNext,
      part_paths: partPaths,
      header_base: headerBase,
      total_dias_com_tabela: totalDiasComTabela,
      total_linhas_dados: totalLinhasDados,
      requested_by: userIdForJob,
      ...(manualConsultaDias?.length
        ? { consulta_dias_br: manualConsultaDias }
        : {}),
    };
    triggerEpocSyncCsvContinueInBackground({
      supabaseUrl,
      serviceKey,
      payload: continuePayload,
      logTag: LOG,
    });
    recordStepWithoutUpload(
      "product_chain_queued",
      "Próximo lote de produtos (auto-chamada)",
      {
        status: "ok",
        message: progressMsg,
        detalhes: {
          next_chain_attempt: chainAttemptEffective + 1,
          days_done: diasDoneNext.length,
          days_planned: diasPlanned.length,
          part_paths: partPaths.length,
        },
      },
    );
    log("product_chain_continue", {
      company_id: companyId,
      product_sync_run_id: productSyncRunId,
      next_attempt: chainAttemptEffective + 1,
      days_done: diasDoneNext.length,
      days_planned: diasPlanned.length,
    });
    return json({
      ok: true,
      continuing: true,
      product_sync_run_id: productSyncRunId,
      chain_attempt: chainAttemptEffective,
      days_done: diasDoneNext.length,
      days_planned: diasPlanned.length,
      days_chunk: diasConsulta.length,
      part_paths_count: partPaths.length,
      steps_prefix: stepsPrefix,
      steps,
      signed_url_expires_in: signedTtl,
      message: progressMsg,
    });
  }

  // --- Consolidação final (último lote ou janela curta) ---------------------
  let csvMergedFromParts: string | null = null;
  if (chainingMode && partPaths.length > 0) {
    const partTexts: string[] = [];
    for (const p of partPaths) {
      const { data: blob, error: dlErr } = await admin.storage
        .from("company-setup")
        .download(p);
      if (dlErr || !blob) {
        log("csv_part_download_falhou", {
          path: p,
          message: dlErr?.message ?? "blob vazio",
        });
        continue;
      }
      partTexts.push(await blob.text());
    }
    csvMergedFromParts = mergeCsvPartTexts(partTexts);
    // Se o último lote falhou no upload, ainda junta as linhas em memória.
    if (
      !chunkPartUploaded &&
      headerBase.length > 0 &&
      linhasCsvFinal.length > 0
    ) {
      csvMergedFromParts = mergeCsvPartTexts([
        csvMergedFromParts,
        matrixToCsv(["data_consumo", ...headerBase], linhasCsvFinal),
      ]);
    }
    if (csvMergedFromParts.trim().length > 0) {
      const lineCount = csvMergedFromParts
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0).length;
      // cabeçalho + dados
      totalLinhasDados = Math.max(0, lineCount - 1);
    }
  } else if (
    chainingMode &&
    !chunkPartUploaded &&
    headerBase.length > 0 &&
    linhasCsvFinal.length > 0
  ) {
    // Cadeia sem partes no storage (uploads falharam): usa memória deste lote.
    csvMergedFromParts = matrixToCsv(
      ["data_consumo", ...headerBase],
      linhasCsvFinal,
    );
  }

  // Dispara serviços/faturamento em background (chunks) — só no fim dos produtos.
  triggerEpocDailyExtrasInBackground({
    supabaseUrl,
    serviceKey,
    companyId,
    continueChain: true,
    maxDays: 3,
    logTag: LOG,
  });
  recordStepWithoutUpload(
    "extras_async_queued",
    "Fila serviços/faturamento (async)",
    {
      status: "ok",
      message:
        "Busca de serviços e faturamento enfileirada em segundo plano (chunks).",
      detalhes: { dias: diasPlanned.length },
    },
  );

  const syncGaps = await listEpocSyncGaps(admin, companyId);
  const partialSummary =
    buildPartialSyncSummary(syncGaps) ??
    (diasPlanned.length > 0
      ? `Sync parcial: produtos processados; serviços/faturamento a concluir em segundo plano (${diasPlanned.length} dia(s)).`
      : null);

  const hasCsvData =
    (csvMergedFromParts != null && csvMergedFromParts.trim().length > 0) ||
    (headerBase.length > 0 && linhasCsvFinal.length > 0) ||
    totalLinhasDados > 0;

  if (!hasCsvData && headerBase.length === 0) {
    const diasComFeedbackPortal = diasPlanned
      .map((d) => {
        const m = mensagemPortalPorDiaBr[d];
        return m ? `${d}: ${m}` : null;
      })
      .filter((x): x is string => x != null);

    let summary: string;
    if (diasPlanned.length === 1) {
      const d0 = diasPlanned[0];
      const mPortal = mensagemPortalPorDiaBr[d0];
      summary = mPortal
        ? `${d0}: ${mPortal}`
        : `Sem dados de receitas no EPOC para o dia ${d0}.`;
    } else if (diasComFeedbackPortal.length > 0) {
      summary = diasComFeedbackPortal.join(" · ");
      if (diasComFeedbackPortal.length < diasPlanned.length) {
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
        dias: diasPlanned,
        sync_mode: syncMode,
        dias_consulta_label: diasConsultaLabel,
        ...(Object.keys(mensagemPortalPorDiaBr).length > 0
          ? { portal_por_dia: mensagemPortalPorDiaBr }
          : {}),
      },
    });

    const flowDiagnostic = buildEpocSyncFlowDiagnostic({
      loginOk: true,
      tblExportFound: false,
      portalSearchSummary: summary,
      diasConsultados: diasPlanned.length,
    });

    const epocCsvSyncRunId = await recordEpocCsvSyncRun({
      outcome: "no_tbl_export",
      summary,
      datesConsulted: diasPlanned,
      flowDiagnostic,
      metadata: {
        dias_consulta_label: diasConsultaLabel,
        tbl_export_found: false,
        manual_consulta: !!manualConsultaDias?.length,
        product_sync_run_id: productSyncRunId,
        ...(Object.keys(mensagemPortalPorDiaBr).length > 0
          ? { portal_por_dia: mensagemPortalPorDiaBr }
          : {}),
      },
    });

    await patchOb({
      portal_busy: false,
      portal_outcome: "no_tbl_export",
      portal_message: summary.slice(0, 500),
      sync: false,
    });

    await persistProductCsvChain(null);

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
        epoc_daily_sync_last_consulted_day_br: diasPlanned[0] ?? null,
        epoc_partial_sync_summary: partialSummary,
        epoc_partial_sync_missing_services_days: syncGaps.services,
        epoc_partial_sync_missing_faturamento_days: syncGaps.faturamento,
        epoc_partial_sync_at: nowIso,
      };
      delete nextSettings[PRODUCT_CHAIN_SETTINGS_KEY];
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
        consulted_day_br: diasPlanned[0] ?? null,
        tblExport_found: false,
        dias_consultados: diasPlanned.length,
        epoc_csv_sync_run_id: epocCsvSyncRunId,
        flow_diagnostic: flowDiagnostic,
        steps_prefix: stepsPrefix,
        steps,
        signed_url_expires_in: signedTtl,
        partial_sync_summary: partialSummary,
      });
    }

    {
      const nowIso = new Date().toISOString();
      const nextSettings: Record<string, unknown> = {
        ...raw,
        epoc_partial_sync_summary: partialSummary,
        epoc_partial_sync_missing_services_days: syncGaps.services,
        epoc_partial_sync_missing_faturamento_days: syncGaps.faturamento,
        epoc_partial_sync_at: nowIso,
      };
      delete nextSettings[PRODUCT_CHAIN_SETTINGS_KEY];
      await admin
        .from("company_integrations")
        .update({
          settings: nextSettings,
          updated_at: nowIso,
        })
        .eq("company_id", companyId)
        .eq("provider", "epoc");
    }

    return await failJson(
      502,
      summary,
      {
        tblExport_found: false,
        dias_consultados: diasPlanned.length,
        epoc_csv_sync_run_id: epocCsvSyncRunId,
        outcome: "no_tbl_export",
        partial_sync_summary: partialSummary,
        product_sync_run_id: productSyncRunId,
      },
      {
        skipPortalPatch: true,
        flowDiagnostic,
      },
    );
  }

  // --- CSV final consolidado -------------------------------------------------
  const csvHeader = ["data_consumo", ...headerBase];
  const csvGenerated =
    csvMergedFromParts && csvMergedFromParts.trim().length > 0
      ? csvMergedFromParts
      : matrixToCsv(csvHeader, linhasCsvFinal);
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
          dias_consultados: diasPlanned.length,
          dias_com_tabela: totalDiasComTabela,
          linhas_dados: totalLinhasDados,
          linhas_csv_total: csvGenerated.split(/\r?\n/).filter(Boolean).length,
          filtro_total_bruto_coluna_encontrada: totalBrutoColIndex >= 0,
          product_sync_run_id: productSyncRunId,
          partes_csv: partPaths.length,
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
  nextSettings.epoc_partial_sync_summary = partialSummary;
  nextSettings.epoc_partial_sync_missing_services_days = syncGaps.services;
  nextSettings.epoc_partial_sync_missing_faturamento_days =
    syncGaps.faturamento;
  nextSettings.epoc_partial_sync_at = nowIso;
  delete nextSettings[PRODUCT_CHAIN_SETTINGS_KEY];

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
  let csvJobEnqueueFailed = false;
  let csvJobTriggerFailed = false;
  const shouldEnqueueCsvImport = !!csvStoragePath && totalLinhasDados > 0;

  if (totalLinhasDados > 0 && !csvStoragePath) {
    csvJobEnqueueFailed = true;
    log("csv_storage_ausente_com_linhas", { linhas_dados: totalLinhasDados });
  }

  if (shouldEnqueueCsvImport) {
    const enqueue = await enqueueAndTriggerEpocCsvImport(admin, {
      companyId,
      requestedBy: userIdForJob,
      storagePath: csvStoragePath,
      metadata: {
        steps_prefix: stepsPrefix,
        source: "epoc-sync-csv",
        sync_mode: syncMode,
        linhas_dados: totalLinhasDados,
        ...(manualConsultaDias?.length
          ? { consulta_dias_br: manualConsultaDias }
          : {}),
      },
      supabaseUrl,
      serviceKey,
      anonKey,
      logTag: LOG,
    });
    if (!enqueue.jobId) {
      csvJobEnqueueFailed = true;
      log("csv_revenue_job_enqueue_falhou", { message: enqueue.error });
    } else {
      csvRevenueImportJobId = enqueue.jobId;
      if (!enqueue.triggerOk) {
        csvJobTriggerFailed = true;
        log("csv_revenue_job_trigger_falhou", {
          job_id: csvRevenueImportJobId,
          error: enqueue.triggerError,
        });
      } else {
        log("csv_revenue_job_disparado", { job_id: csvRevenueImportJobId });
      }
    }
  }

  const importFinalizedEmpty = !!csvStoragePath && totalLinhasDados === 0;

  await patchOb({
    portal_busy: false,
    portal_outcome: "success",
    portal_message: null,
    ...(importFinalizedEmpty
      ? {
          import_status: "completed",
          sync: false,
          sales_total: 0,
          sales_sync: 0,
          csv_import_job_id: null,
          csv_storage_path: csvStoragePath,
        }
      : csvJobEnqueueFailed
        ? {
            import_status: "failed",
            import_error:
              totalLinhasDados > 0 && !csvStoragePath
                ? "CSV gerado, mas não foi guardado no Storage. Tente «Tentar novamente»."
                : "CSV exportado, mas não foi possível enfileirar a importação. Tente «Retomar importação».",
            sync: false,
            csv_import_job_id: null,
            csv_storage_path: csvStoragePath,
          }
        : csvJobTriggerFailed
          ? {
              import_status: "pending",
              import_error:
                "CSV enfileirado; o processamento demorou a iniciar. Use «Retomar importação».",
              csv_import_job_id: csvRevenueImportJobId,
              csv_storage_path: csvStoragePath,
              import_started_at: nowIso,
            }
          : csvRevenueImportJobId
            ? {
                import_status: "pending",
                import_error: null,
                csv_import_job_id: csvRevenueImportJobId,
                csv_storage_path: csvStoragePath,
                import_started_at: nowIso,
              }
            : {
                import_status: null,
                csv_import_job_id: null,
                csv_storage_path: csvStoragePath,
              }),
  });

  const flowDiagnostic = buildEpocSyncFlowDiagnostic({
    loginOk: true,
    tblExportFound: true,
    csvUploaded: !!csvStoragePath,
    csvEmpty: !csvStoragePath,
    diasComTabela: totalDiasComTabela,
    linhasDados: totalLinhasDados,
    csvRevenueImportJobId,
    csvJobEnqueueFailed,
  });

  const successSummary =
    csvStoragePath && totalLinhasDados > 0
      ? `CSV exportado com ${totalLinhasDados} linha(s) em ${totalDiasComTabela} dia(s).`
      : csvStoragePath
        ? "CSV exportado, mas sem linhas de dados após filtro."
        : "Sincronização concluída sem CSV guardado.";

  const epocCsvSyncRunId = await recordEpocCsvSyncRun({
    outcome: "success",
    summary: successSummary,
    datesConsulted: diasPlanned,
    flowDiagnostic,
    metadata: {
      tbl_export_found: true,
      dias_com_tabela: totalDiasComTabela,
      linhas_dados: totalLinhasDados,
      csv_storage_path: csvStoragePath,
      csv_revenue_import_job_id: csvRevenueImportJobId,
      dias_consulta_label: diasConsultaLabel,
      product_sync_run_id: productSyncRunId,
      chained: chainingMode,
    },
  });

  if (epocCsvSyncRunId && csvRevenueImportJobId) {
    const { data: jobRow } = await admin
      .from("integration_csv_revenue_import_jobs")
      .select("metadata")
      .eq("id", csvRevenueImportJobId)
      .maybeSingle();
    const jobMeta =
      jobRow?.metadata &&
      typeof jobRow.metadata === "object" &&
      !Array.isArray(jobRow.metadata)
        ? (jobRow.metadata as Record<string, unknown>)
        : {};
    const { error: linkErr } = await admin
      .from("integration_csv_revenue_import_jobs")
      .update({
        metadata: {
          ...jobMeta,
          epoc_csv_sync_run_id: epocCsvSyncRunId,
        },
      })
      .eq("id", csvRevenueImportJobId);
    if (linkErr) {
      log("csv_job_link_sync_run_falhou", {
        job_id: csvRevenueImportJobId,
        sync_run_id: epocCsvSyncRunId,
        message: linkErr.message,
      });
    }
  }

  log("concluido", {
    steps: steps.length,
    csv_revenue_import_job_id: csvRevenueImportJobId,
    product_sync_run_id: productSyncRunId,
    chained: chainingMode,
    flow_blocked_at: flowDiagnostic.blocked_at,
  });

  return json({
    ok: true,
    continuing: false,
    product_sync_run_id: productSyncRunId,
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
    flow_diagnostic: flowDiagnostic,
    epoc_csv_sync_run_id: epocCsvSyncRunId,
  });
});

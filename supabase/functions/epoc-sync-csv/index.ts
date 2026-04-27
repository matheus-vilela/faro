/**
 * EPOC: cada etapa do portal é guardada e disponibilizada no Storage como `step` para
 * download e inspeção (login → index → validadorOz/acoes fase1 → validadorOz/acoes fase2).
 * Cada step traz: bytes, content-type, http_status, presença de ids relevantes
 * (`ConteudoTela`, `tblExport`) e URL assinada. O sucesso só é declarado quando a
 * fase 2 contém `id=tblExport`; mesmo no erro o JSON inclui o trace com as URLs.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOG = "[epoc-sync-csv]";

const DEFAULT_LOGIN_PATH = "/index.php";
/** Muitas instalações usam `user` (HAR); defina `portal_user_field` se for `usuario`. */
const DEFAULT_USER_FIELD = "user";
const DEFAULT_PASS_FIELD = "senha";

const PATH_INDEX = "/index.php";
/** POST com NaoMenu+token, como no curl do browser, antes de `acoes.php`. */
const PATH_VALIDADOR_OZ = "/validadorOz.php";
const PATH_ACOES = "/acoes.php";
const MODULO_REL = "mod_rel_produto_sintetico";
const DEFAULT_NAOMENU = "123A";

/** Só usamos o `id` destes nós (como no DOM do EPOC) — sem classes ou outros atributos. */
const EPOC_ID_CONTEUDO_TELA = "ConteudoTela";
const EPOC_ID_TBL_EXPORT = "tblExport";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

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

function buildActionUrl(baseUrl: string, loginPath: string): string {
  const b = trimBaseUrl(baseUrl);
  const p = (loginPath.trim() || DEFAULT_LOGIN_PATH).replace(/^\//, "");
  return `${b}/${p}`;
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
    if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
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

function buildTblExportDocument(tableOuterHtml: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EPOC — tabela de exportação</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@3.4.1/dist/css/bootstrap.min.css" crossorigin="anonymous" />
<style>
body{padding:12px 16px}
.color_back_epoc,.color_back_epoc a{background-color:#337ab7 !important;color:#fff !important}
</style>
</head>
<body>
${tableOuterHtml}
</body>
</html>
`;
}

function escapeHtmlForPre(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Documento HTML com a resposta bruta de um passo, para revisão pelo utilizador. */
function buildRawDebugDocument(
  title: string,
  note: string,
  rawText: string,
): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body{font-family:system-ui,Segoe UI,sans-serif;padding:12px 16px;margin:0}
pre{white-space:pre-wrap;word-break:break-all;background:#f6f8fa;border:1px solid #e1e4e8;border-radius:6px;padding:12px;max-width:100%}
p.note{color:#666;font-size:0.9rem}
</style>
</head>
<body>
<p class="note">${note}</p>
<pre>${escapeHtmlForPre(rawText)}</pre>
</body>
</html>
`;
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

function extractTokenFromHtml(html: string): string {
  const patterns: RegExp[] = [
    /name=["']token["'][^>]*value=["']([^"']*)/i,
    /id=["']token["'][^>]*value=["']([^"']+)/i,
    /value=["']([^"']+)["'][^>]*name=["']token["']/i,
  ];
  for (const p of patterns) {
    const m = p.exec(html);
    if (m && m[1] !== undefined && m[1].length > 0) return m[1];
  }
  const tente = /Tente_A_Vontade_[^\s"'<>&]+/.exec(html);
  if (tente) return tente[0].trim();
  return "";
}

/** Coleta campos hidden de um formulário HTML (name+value). */
function extractHiddenInputsFromHtml(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re =
    /<input\b[^>]*\btype\s*=\s*["']?hidden["']?[^>]*>|<input\b[^>]*\bname\s*=\s*["'][^"']+["'][^>]*\btype\s*=\s*["']?hidden["']?[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const nameM = /\bname\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!nameM || !nameM[1]) continue;
    const valueM = /\bvalue\s*=\s*["']([^"']*)["']/i.exec(tag);
    out[nameM[1]] = valueM?.[1] ?? "";
  }
  return out;
}

function extractLoginFormHints(html: string): {
  action: string | null;
  userField: string | null;
  passField: string | null;
} {
  const formMatch = /<form\b[^>]*>/i.exec(html);
  const formTag = formMatch?.[0] ?? "";
  const actionMatch = /\baction\s*=\s*["']([^"']+)["']/i.exec(formTag);
  const action = actionMatch?.[1]?.trim() || null;

  let passField: string | null = null;
  let userField: string | null = null;

  const inputRe = /<input\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = inputRe.exec(html)) !== null) {
    const tag = m[0];
    const type = (
      /\btype\s*=\s*["']?([^"'\s>]+)["']?/i.exec(tag)?.[1] ?? ""
    ).toLowerCase();
    const name = /\bname\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
    if (!name) continue;
    if (!passField && type === "password") {
      passField = name;
      continue;
    }
    if (
      !userField &&
      (type === "text" || type === "email" || type === "" || type === "tel")
    ) {
      userField = name;
    }
  }
  return { action, userField, passField };
}

/** Extrai o nó com id `tblExport` (ou de string JSON com campo html/conteudo). */
function buildTblExportFileOrError(
  acoesText: string,
): { doc: string } | { error: string } {
  const html = unwrapAcoesHtml(acoesText);
  const bloco = extractElementOuterHtmlById(html, EPOC_ID_TBL_EXPORT);
  if (!bloco) {
    return {
      error:
        "A resposta final de acoes.php não contém o elemento com id=tblExport.",
    };
  }
  return { doc: buildTblExportDocument(bloco) };
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

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return json({ ok: false, error: "Sessão inválida" }, 401);
  }

  let body: { company_id?: string } = {};
  try {
    body = (await req.json()) as { company_id?: string };
  } catch {
    return json({ ok: false, error: "JSON inválido" }, 400);
  }
  const companyId =
    typeof body.company_id === "string" ? body.company_id.trim() : "";
  if (!companyId) {
    return json({ ok: false, error: "company_id é obrigatório" }, 400);
  }

  const { data: member } = await supabase
    .from("user_companies")
    .select("role")
    .eq("company_id", companyId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) {
    return json({ ok: false, error: "Sem acesso a esta unidade" }, 403);
  }

  const { data: integ, error: integErr } = await supabase
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
  const baseUrl = String(raw.base_url ?? "").trim();
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

  const actionUrl = buildActionUrl(baseUrl, loginPath);
  const form = new URLSearchParams();

  const admin = createClient(supabaseUrl, serviceKey);
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

  function failJson(
    httpStatus: number,
    error: string,
    extras: Record<string, unknown> = {},
  ): Response {
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

  log("inicio", {
    company_id: companyId,
    naoMenu,
    steps_prefix: stepsPrefix,
  });

  // --- Step 0: GET página de login para capturar hidden fields dinâmicos ----
  let cookies = "";
  let hiddenFromPage: Record<string, string> = {};
  let loginActionOverride: string | null = null;
  let userFieldAuto: string | null = null;
  let passFieldAuto: string | null = null;
  try {
    const preLoginRes = await fetch(actionUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,*/*",
        "User-Agent": BROWSER_UA,
      },
      redirect: "follow",
    });
    {
      const more = collectSetCookieHeader(preLoginRes.headers);
      if (more) cookies = mergeCookieStrings(cookies, more);
    }
    const preLoginText = await preLoginRes.text();
    hiddenFromPage = extractHiddenInputsFromHtml(preLoginText);
    const hints = extractLoginFormHints(preLoginText);
    loginActionOverride = hints.action;
    userFieldAuto = hints.userField;
    passFieldAuto = hints.passField;
    await recordStepWithUpload(
      "pre_login_get",
      "GET página de login (capturar hidden)",
      "pre-login.html",
      new TextEncoder().encode(preLoginText),
      preLoginRes.headers.get("Content-Type") ?? "text/html",
      {
        http_status: preLoginRes.status,
        status: preLoginRes.ok ? "ok" : "warn",
        detalhes: {
          cookies: cookieNameList(cookies),
          hidden_count: Object.keys(hiddenFromPage).length,
          hidden_keys: Object.keys(hiddenFromPage).slice(0, 40),
          form_action: loginActionOverride,
          user_field_auto: userFieldAuto,
          pass_field_auto: passFieldAuto,
          ...inspectResponseHtml(preLoginText),
        },
      },
    );
  } catch (e) {
    recordStepWithoutUpload("pre_login_get", "GET página de login", {
      status: "warn",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  // Prioriza hidden dinâmico da página e completa com configuração persistida.
  for (const [k, v] of Object.entries(hiddenFromPage)) {
    form.set(k, v);
  }
  for (const [k, v] of Object.entries(hidden)) {
    if (!form.has(k)) form.set(k, v);
  }
  const userField =
    userFieldFromSettings || userFieldAuto || DEFAULT_USER_FIELD;
  const passField =
    passFieldFromSettings || passFieldAuto || DEFAULT_PASS_FIELD;
  form.set(userField, username);
  form.set(passField, password);
  const loginSubmitUrl = loginActionOverride
    ? resolveUrlAgainstBase(baseUrl, loginActionOverride)
    : actionUrl;

  // --- Step 1: login (POST com formulário) ----------------------------------
  let loginRes: Response;
  try {
    loginRes = await fetch(loginSubmitUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html,application/xhtml+xml,*/*",
        Origin: trimBaseUrl(baseUrl),
        Referer: actionUrl,
        "User-Agent": BROWSER_UA,
        Cookie: cookies,
      },
      body: form.toString(),
      redirect: "manual",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha de rede no login EPOC";
    recordStepWithoutUpload("login", "POST login", {
      status: "fail",
      message: msg,
    });
    return failJson(502, msg);
  }
  {
    const more = collectSetCookieHeader(loginRes.headers);
    if (more) cookies = mergeCookieStrings(cookies, more);
  }
  const loginLocation = loginRes.headers.get("Location") ?? null;
  let tokenFromSession = "";
  const loginBuf = await loginRes.arrayBuffer();
  const loginText = new TextDecoder("utf-8", { fatal: false })
    .decode(loginBuf)
    .replace(/^\uFEFF/, "");
  const loginInsight = inspectResponseHtml(loginText);
  const loginToken = extractTokenFromHtml(loginText);
  if (loginToken) tokenFromSession = loginToken;
  await recordStepWithUpload(
    "login",
    "POST de login com user/senha",
    "login.html",
    new TextEncoder().encode(
      buildRawDebugDocument(
        "EPOC — POST login",
        `URL: ${loginSubmitUrl}. Status: ${loginRes.status}. Location: ${loginLocation ?? "(nenhum)"}. Campos: user=${userField}, pass=${passField}. Cookies recebidos: ${cookieNameList(cookies) || "(vazio)"}.`,
        loginText,
      ),
    ),
    "text/html; charset=utf-8",
    {
      http_status: loginRes.status,
      status: loginRes.status >= 200 && loginRes.status < 400 ? "ok" : "fail",
      message:
        loginRes.status >= 300 && loginRes.status < 400
          ? "Redirect — a seguir Location."
          : loginToken
            ? `Token detectado no login (len=${loginToken.length}).`
            : undefined,
      detalhes: {
        location: loginLocation,
        submit_url: loginSubmitUrl,
        form_action: loginActionOverride,
        user_field: userField,
        pass_field: passField,
        token_len: loginToken.length,
        token_previa: previewText(loginToken, 24),
        cookies: cookieNameList(cookies),
        ...loginInsight,
      },
    },
  );
  if (loginRes.status >= 400) {
    return failJson(502, `Login HTTP ${loginRes.status}.`);
  }

  // --- Step 2 (opcional): seguir redirect manualmente para apanhar cookies --
  if (loginRes.status >= 300 && loginRes.status < 400 && loginLocation) {
    try {
      const nextUrl = new URL(loginLocation, loginSubmitUrl);
      const follow = await fetch(nextUrl.toString(), {
        method: "GET",
        headers: {
          Cookie: cookies,
          Accept: "text/html",
          "User-Agent": BROWSER_UA,
        },
        redirect: "manual",
      });
      const moreCookies = collectSetCookieHeader(follow.headers);
      if (moreCookies) cookies = mergeCookieStrings(cookies, moreCookies);
      const followBuf = await follow.arrayBuffer();
      const followText = new TextDecoder("utf-8", { fatal: false })
        .decode(followBuf)
        .replace(/^\uFEFF/, "");
      await recordStepWithUpload(
        "login_redirect",
        `GET ${nextUrl.pathname}`,
        "login-redirect.html",
        new TextEncoder().encode(
          buildRawDebugDocument(
            "EPOC — login redirect",
            `URL: ${nextUrl.toString()}. Status: ${follow.status}. Cookies pós-redirect: ${cookieNameList(cookies) || "(vazio)"}.`,
            followText,
          ),
        ),
        "text/html; charset=utf-8",
        {
          http_status: follow.status,
          status: follow.ok ? "ok" : "warn",
          detalhes: {
            cookies: cookieNameList(cookies),
            ...inspectResponseHtml(followText),
            token_len: extractTokenFromHtml(followText).length,
          },
        },
      );
      if (!tokenFromSession) {
        const followToken = extractTokenFromHtml(followText);
        if (followToken) tokenFromSession = followToken;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      recordStepWithoutUpload("login_redirect", "GET (Location)", {
        status: "warn",
        message: msg,
      });
    }
  }

  // Sem cookies de sessão é fútil continuar.
  if (!cookies.trim()) {
    return failJson(
      502,
      "Login não devolveu cookies de sessão (PHPSESSID). Verifique credenciais e URL base.",
    );
  }

  const origin = trimBaseUrl(baseUrl);
  const refererIndex = `${origin}/index.php`;

  // --- Step 3: token da sessão; só chama index se ainda não tiver token ------
  let token = tokenFromSession;
  if (!token) {
    const indexUrl = resolveUrlAgainstBase(baseUrl, PATH_INDEX);
    let indexHtml = "";
    try {
      const indexRes = await fetch(indexUrl, {
        method: "GET",
        headers: {
          Cookie: cookies,
          Accept: "text/html,application/xhtml+xml,*/*",
          "User-Agent": BROWSER_UA,
        },
        redirect: "follow",
      });
      const more = collectSetCookieHeader(indexRes.headers);
      if (more) cookies = mergeCookieStrings(cookies, more);
      indexHtml = await indexRes.text();
      const insight = inspectResponseHtml(indexHtml);
      await recordStepWithUpload(
        "index",
        "GET /index.php (após login)",
        "index.html",
        new TextEncoder().encode(indexHtml),
        "text/html; charset=utf-8",
        {
          http_status: indexRes.status,
          status: indexRes.ok ? "ok" : "fail",
          message: !indexRes.ok
            ? `HTTP ${indexRes.status}`
            : !insight.has_token_field
              ? "index.php não tem campo `token` nem `Tente_A_Vontade_…`."
              : undefined,
          detalhes: { cookies: cookieNameList(cookies), ...insight },
        },
      );
      if (!indexRes.ok) {
        return failJson(
          502,
          `Não foi possível carregar ${PATH_INDEX}: HTTP ${indexRes.status}.`,
        );
      }
      token = extractTokenFromHtml(indexHtml);
      if (insight.has_login_form && !token) {
        return failJson(
          502,
          "Login parece ter falhado: index.php devolveu o formulário de login sem token.",
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "rede";
      recordStepWithoutUpload("index", "GET /index.php", {
        status: "fail",
        message: msg,
      });
      return failJson(502, `Falha ao obter ${PATH_INDEX}: ${msg}`);
    }
  } else {
    recordStepWithoutUpload("index_skip_com_token", "Pular GET /index.php", {
      status: "ok",
      message:
        "Token já encontrado no passo 2; seguindo para validadorOz + acoes.",
      detalhes: {
        token_len: token.length,
        token_previa: previewText(token, 24),
      },
    });
  }

  recordStepWithoutUpload("token", "Token de sessão consolidado", {
    status: token ? "ok" : "warn",
    message: token
      ? `token len=${token.length}, prévia=${previewText(token, 12)}`
      : "Sem token explícito na sessão (login/index).",
    detalhes: {
      vazio: !token,
      previa: previewText(token, 24),
    },
  });

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
    return failJson(502, v1.message ?? "validadorOz fase1 falhou.");
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
    return failJson(502, acoes1.step.message ?? "acoes.php (fase1) falhou.");
  }
  if (!hasConteudoTela(acoes1.text)) {
    acoes1.step.status = "fail";
    acoes1.step.message =
      "Resposta de acoes.php (fase1) não contém id=ConteudoTela.";
    log("conteudo_tela_nao_encontrado", {
      previa: previewText(acoes1.text, 800),
    });
    return failJson(
      502,
      "Resposta de acoes.php (fase1) não contém id=ConteudoTela. Verifique credenciais, NaoMenu e o módulo configurado.",
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

  // --- Fase 2: últimos 60 dias (consulta diária) ----------------------------
  const diasConsulta = lastNDaysBr(60);
  const headerBase: string[] = [];
  const linhasCsvFinal: string[][] = [];
  let totalDiasComTabela = 0;
  let totalLinhasDados = 0;
  let lastTblDoc: string | null = null;

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
          return {
            dia,
            suffix,
            ok: false as const,
            message: "Sem id=tblExport para este dia.",
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
        recordStepWithoutUpload(
          `fase2_${result.suffix}_resumo`,
          `Resumo consulta diária ${result.dia}`,
          {
            status: "warn",
            message: result.message,
            detalhes: { dia: result.dia },
          },
        );
        continue;
      }
      if (headerBase.length === 0) {
        headerBase.push(...result.parsed.header);
      }
      const targetLen = headerBase.length;
      let linhasDia = 0;
      for (const row of result.parsed.rows) {
        const ajustada = row.slice(0, targetLen);
        while (ajustada.length < targetLen) ajustada.push("");
        linhasCsvFinal.push([result.dia, ...ajustada]);
        linhasDia++;
      }
      totalDiasComTabela++;
      totalLinhasDados += linhasDia;
      lastTblDoc = buildTblExportDocument(result.tableHtml);
      recordStepWithoutUpload(
        `fase2_${result.suffix}_resumo`,
        `Resumo consulta diária ${result.dia}`,
        {
          status: "ok",
          message: `tblExport encontrada com ${linhasDia} linha(s) de dados.`,
          detalhes: {
            dia: result.dia,
            header_cols: result.parsed.header.length,
          },
        },
      );
    }
  }

  if (!lastTblDoc || headerBase.length === 0) {
    return failJson(
      502,
      "Nenhuma tabela #tblExport encontrada na janela dos últimos 60 dias.",
      { tblExport_found: false, dias_consultados: diasConsulta.length },
    );
  }

  const docBytes = new TextEncoder().encode(lastTblDoc);
  const finalStep = await recordStepWithUpload(
    "tblExport_final",
    "HTML final com a última tabela #tblExport encontrada",
    "tblExport.html",
    docBytes,
    "text/html; charset=utf-8",
    { status: "ok" },
  );
  const acoesResponsePath = finalStep.storage_path ?? "";
  const acoesResponseFileName = finalStep.file_name ?? "";
  const acoesResponseDownloadUrl = finalStep.download_url ?? null;

  if (!acoesResponsePath) {
    return failJson(500, "Não foi possível guardar a tabela final no Storage.");
  }

  // --- CSV final consolidado (60 dias) --------------------------------------
  const csvHeader = ["data_consumo", ...headerBase];
  const csvGenerated = matrixToCsv(csvHeader, linhasCsvFinal);
  let csvStoragePath: string | null = null;
  let csvFileName: string | null = null;
  let csvSizeBytes = 0;
  let csvDownloadUrl: string | null = null;

  if (csvGenerated.trim().length > 0) {
    const csvStep = await recordStepWithUpload(
      "csv_from_tbl_export",
      "CSV final consolidado dos últimos 60 dias",
      "tblExport-ultimos-60-dias.csv",
      new TextEncoder().encode(csvGenerated),
      "text/csv",
      {
        status: "ok",
        detalhes: {
          origem: "table_to_csv_60_days",
          dias_consultados: diasConsulta.length,
          dias_com_tabela: totalDiasComTabela,
          linhas_dados: totalLinhasDados,
          linhas_csv_total: csvGenerated.split(/\r?\n/).filter(Boolean).length,
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
    last_epoc_acoes_response_sync_at: nowIso,
    last_epoc_acoes_response_storage_path: acoesResponsePath,
  };
  if (csvStoragePath) {
    nextSettings.last_epoc_csv_sync_at = nowIso;
    nextSettings.last_epoc_csv_storage_path = csvStoragePath;
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
    return failJson(
      500,
      `Conteúdo salvo no Storage, mas metadados não atualizados: ${upIntegErr.message}.`,
      {
        acoes_response_storage_path: acoesResponsePath,
        acoes_response_file_name: acoesResponseFileName,
        acoes_response_size_bytes: docBytes.length,
        acoes_response_content_type: "text/html; charset=utf-8",
        acoes_response_download_url: acoesResponseDownloadUrl,
        html_download_url: acoesResponseDownloadUrl,
      },
    );
  }

  let csvRevenueImportJobId: string | null = null;
  if (csvStoragePath) {
    const { data: jobIns, error: jobErr } = await admin
      .from("integration_csv_revenue_import_jobs")
      .insert({
        company_id: companyId,
        requested_by: user.id,
        provider: "epoc",
        storage_bucket: "company-setup",
        storage_path: csvStoragePath,
        status: "PENDING",
        metadata: {
          steps_prefix: stepsPrefix,
          source: "epoc-sync-csv",
        },
      })
      .select("id")
      .maybeSingle();
    if (jobErr) {
      log("csv_revenue_job_enqueue_falhou", { message: jobErr.message });
    } else if (jobIns?.id) {
      csvRevenueImportJobId = String(jobIns.id);
      scheduleProcessCsvRevenueJob(supabaseUrl, serviceKey, anonKey, csvRevenueImportJobId);
      log("csv_revenue_job_disparado", { job_id: csvRevenueImportJobId });
    }
  }

  log("concluido", {
    acoes_response_path: acoesResponsePath,
    doc_bytes: docBytes.length,
    steps: steps.length,
    csv_revenue_import_job_id: csvRevenueImportJobId,
  });

  return json({
    ok: true,
    steps_prefix: stepsPrefix,
    steps,
    tblExport_found: true,
    acoes_response_storage_path: acoesResponsePath,
    acoes_response_file_name: acoesResponseFileName,
    acoes_response_size_bytes: docBytes.length,
    acoes_response_content_type: "text/html; charset=utf-8",
    acoes_response_download_url: acoesResponseDownloadUrl,
    /** Legado: mesmo que `acoes_response_download_url`. */
    html_download_url: acoesResponseDownloadUrl,
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

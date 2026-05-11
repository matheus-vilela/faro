/**
 * Sincroniza NF-es recebidas via API Focus (/v2/nfes_recebidas): listagem paginada (cursor `versao`),
 * enfileiramento em `focus_nfe_recebidas_sync_queue`, download assíncrono por fatias de XML e delegação
 * a `import_job_batches` → `process-import-job-batch`.
 *
 * **Fases (body `phase`):** `list` (só cabeçalhos + fila), `download` (só claim + XML + batch), `auto` (ambas, com orçamentos).
 * Default: `auto`. Cron sem body usa `auto`.
 *
 * **Orçamentos (env, opcionais):**
 * - `FOCUS_SYNC_MAX_COMPANIES_PER_RUN` (default 1) — cron processa no máximo N unidades elegíveis por POST.
 * - `FOCUS_SYNC_MAX_LIST_PAGES` (default 8) — páginas Focus GET por unidade por fase list.
 * - `FOCUS_SYNC_LIST_PAGE_SIZE` (default 25) — `limite` no GET lista; paginação trata também respostas com até 100 itens (teto histórico da API).
 * - `FOCUS_SYNC_MAX_XML_DOWNLOADS_PER_RUN` (default 20) — XMLs por unidade por fase download.
 * - `FOCUS_SYNC_SOFT_BUDGET_MS` (0 = desligado) — corta loops quando o tempo desde o início excede.
 * - `FOCUS_SYNC_LEASE_MINUTES` (default 30) — `focusnfe.nfes_recebidas_sync_lease_until` evita sobreposição cron (manual ignora).
 * - `FOCUS_SYNC_MAX_CHAIN_DEPTH` (default 2) — profundidade de auto re-invoke via `waitUntil(fetch)`.
 *
 * Outros: `FOCUS_NFE_XML_THROTTLE_MS`, `FOCUS_NFE_API_BASE`, secrets Supabase + `FOCUS_NFE_TOKEN` + `FOCUS_NFE_RECEBIDAS_CRON_SECRET`.
 * Logs: `FOCUS_SYNC_VERBOSE_LOGS=true` habilita eventos por página/checkpoint (padrão: só início/fim, erros e resumo enxuto).
 *
 * **Cron:** POST `Authorization: Bearer <secret>`. Opcional body `{ "company_id": "<uuid>" }` para uma unidade (recomendado com pg_net).
 * **Manual:** body pode incluir `max_list_pages`, `max_xml_downloads`, `max_chain_depth`, `list_page_size` (substituem env só nesse POST) além de `versao_inicial`, `phase`, `chain_depth`.
 *
 * **Processor:** após `import_job_files`, dispara `process-import-job-batch` com `invoke` não bloqueante + `EdgeRuntime.waitUntil` quando existir.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const LOG = "[focus-sync-nfe-recebidas]";

const VERBOSE_LOGS =
  String(Deno.env.get("FOCUS_SYNC_VERBOSE_LOGS") ?? "").trim() === "true";

/** Teto histórico de itens por resposta na lista NF-e recebidas (Focus). */
const FOCUS_NFES_RECEBIDAS_LIST_MAX_LEGACY = 100;

const QUEUE_MAX_ATTEMPTS_FAIL = 8;

type Phase = "list" | "download" | "auto";

type QueueRow = {
  id: string;
  company_id: string;
  nfe_access_key: string;
  versao: number | null;
  status: string;
  batch_id: string | null;
  attempt_count: number;
  last_error: string | null;
};

/** Logs legíveis nos logs da Supabase Edge (filtrar por prefixo `[focus-sync-nfe-recebidas]`). */
function slog(
  fase: string,
  empresa: string | null,
  mensagem: string,
  extras?: Record<string, unknown>,
): void {
  const base = { fase, empresa: empresa ?? "—", mensagem };
  const line =
    extras && Object.keys(extras).length > 0
      ? `${JSON.stringify({ ...base, ...extras })}`
      : `${JSON.stringify(base)}`;
  console.log(LOG, line);
}

/** Detalhe por página/checkpoint — só com `FOCUS_SYNC_VERBOSE_LOGS=true`. */
function slogV(
  fase: string,
  empresa: string | null,
  mensagem: string,
  extras?: Record<string, unknown>,
): void {
  if (!VERBOSE_LOGS) return;
  slog(fase, empresa, mensagem, extras);
}

function marcador(unidadeId: string, acao: string, detalhes: Record<string, unknown>): void {
  const isErr =
    acao.includes("ERRO") || acao.includes("EXCECAO") || acao.includes("FALH");
  if (!VERBOSE_LOGS && !isErr) return;
  console.log(LOG, JSON.stringify({ unidade: unidadeId, acao, ...detalhes }));
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

function focusBasicAuthHeader(token: string): string {
  const pair = `${token.trim()}:`;
  let binary = "";
  for (let i = 0; i < pair.length; i++) {
    binary += String.fromCharCode(pair.charCodeAt(i));
  }
  return `Basic ${btoa(binary)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => globalThis.setTimeout(r, ms));
}

function intFromEnv(name: string, defaultVal: number, min: number, max: number): number {
  const raw = Deno.env.get(name)?.trim();
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return defaultVal;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/** Inteiro opcional no body (modo manual com limites explícitos). */
function optionalBodyInt(
  raw: unknown,
  min: number,
  max: number,
): number | null {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return null;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function throttleMsBetweenXmlDownloads(): number {
  const raw = Deno.env.get("FOCUS_NFE_XML_THROTTLE_MS")?.trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return 450;
}

/** Modo teste: sem espera entre downloads (só 1 XML por vez na prática). */
function throttleMsForSyncRun(manualTestMode: boolean): number {
  if (manualTestMode) return 0;
  return throttleMsBetweenXmlDownloads();
}

function retryAfterDelayMs(res: Response): number | null {
  const raw = res.headers.get("Retry-After")?.trim();
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 300_000);
  const deadline = Date.parse(raw);
  if (Number.isFinite(deadline)) {
    const w = deadline - Date.now();
    if (Number.isFinite(w)) return Math.min(Math.max(0, Math.floor(w)), 300_000);
  }
  return null;
}

async function fetchNfeRecebidaXmlWithRetry(
  xmlUrl: string,
  focusToken: string,
  chaveNfe44: string,
): Promise<{ ok: true; buf: Uint8Array } | { ok: false; status: number }> {
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let xmlRes: Response;
    try {
      xmlRes = await fetch(xmlUrl, {
        method: "GET",
        headers: {
          Authorization: focusBasicAuthHeader(focusToken),
          Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
        },
      });
    } catch (e) {
      console.warn(
        LOG,
        JSON.stringify({
          fase: "xml_focus_erro_rede",
          chave_nfe_44: chaveNfe44,
          tentativa: attempt,
          erro: String(e),
        }),
      );
      if (attempt === maxAttempts) {
        return { ok: false, status: 0 };
      }
      await sleep(Math.min(3000 * attempt, 25_000));
      continue;
    }

    const buf = new Uint8Array(await xmlRes.arrayBuffer());

    if (xmlRes.status === 429) {
      const fromHeader = retryAfterDelayMs(xmlRes);
      const backoff = Math.min(1500 * 2 ** (attempt - 1), 90_000);
      const waitMs = fromHeader ?? backoff;
      console.warn(
        LOG,
        `xml HTTP 429 chave=${chaveNfe44} tentativa=${attempt}/${maxAttempts} espera_ms=${waitMs}`,
      );
      if (attempt === maxAttempts) return { ok: false, status: 429 };
      await sleep(waitMs);
      continue;
    }

    if (
      (xmlRes.status === 503 || xmlRes.status === 502) &&
      attempt < maxAttempts
    ) {
      const waitMs = Math.min(4000 * attempt, 45_000);
      console.warn(
        LOG,
        `xml HTTP ${xmlRes.status} chave=${chaveNfe44} retry em ${waitMs}ms`,
      );
      await sleep(waitMs);
      continue;
    }

    if (xmlRes.ok && buf.length >= 500) {
      return { ok: true, buf };
    }

    console.warn(
      LOG,
      JSON.stringify({
        fase: "xml_focus_resposta",
        chave_nfe_44: chaveNfe44,
        mensagem: "HTTP não OK ou payload pequeno",
        http_status: xmlRes.status,
        bytes: buf.length,
      }),
    );
    return { ok: false, status: xmlRes.status };
  }
  return { ok: false, status: 429 };
}

async function sha256Hex(input: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", input.slice());
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++)
    hex += bytes[i]!.toString(16).padStart(2, "0");
  return hex;
}

function base64FromBytes(input: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < input.length; i += 1) {
    binary += String.fromCharCode(input[i]!);
  }
  return btoa(binary);
}

type NfeCab = {
  chave_nfe: string;
  versao?: number;
  situacao?: string;
  nfe_completa?: boolean;
  nome_emitente?: string;
  valor_total?: number | string;
  valor?: number | string;
  total?: number | string;
};

function nfeCompletaTrue(cab: NfeCab): boolean {
  const raw = (cab as Record<string, unknown>).nfe_completa;
  // Alguns payloads da Focus omitem este campo no endpoint de listagem.
  // Nestes casos, seguimos com a tentativa de download do XML por chave.
  if (raw === undefined || raw === null || String(raw).trim() === "") return true;
  if (raw === true) return true;
  if (typeof raw === "string" && raw.trim().toLowerCase() === "true") return true;
  if (raw === 1) return true;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "1" || s === "sim" || s === "yes") return true;
  }
  return false;
}

function nfeRecebidaImportavel(cab: NfeCab): boolean {
  const situacao = String(cab.situacao ?? "").trim().toLowerCase();
  const autorizada = situacao === "autorizada" || situacao === "autorizado";
  return autorizada && nfeCompletaTrue(cab);
}

/**
 * Modo teste manual (sem `test_single_key`): a API Focus pode devolver até ~100 itens por página
 * (ou o tamanho pedido em `limite`); limitamos a N cabeçalhos importáveis para não disparar dedup/fila em lote cheio.
 */
function limitCabListForManualTest(
  cabList: NfeCab[],
  opts: {
    isManualSingle: boolean;
    manualTestMode: boolean;
    manualTestSingleKey: string | null;
    maxImportable: number;
  },
): NfeCab[] {
  const { isManualSingle, manualTestMode, manualTestSingleKey, maxImportable } = opts;
  if (!isManualSingle || !manualTestMode || manualTestSingleKey || maxImportable <= 0) {
    return cabList;
  }
  const out: NfeCab[] = [];
  for (const cab of cabList) {
    const chave = String(cab.chave_nfe ?? "").replace(/\D/g, "");
    if (chave.length !== 44) continue;
    if (!nfeRecebidaImportavel(cab)) continue;
    out.push(cab);
    if (out.length >= maxImportable) break;
  }
  return out;
}

function focusIdEmpresa(raw: Record<string, unknown> | undefined): unknown {
  const v = raw?.id_empresa;
  if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  return null;
}

function parsePhase(raw: unknown): Phase {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "list" || s === "download" || s === "auto") return s;
  return "auto";
}

function budgetExceeded(t0: number, softBudgetMs: number): boolean {
  if (softBudgetMs <= 0) return false;
  return performance.now() - t0 > softBudgetMs;
}

/** Página “cheia” — pode existir continuação na próxima versão. */
function listFocusPageIsFull(len: number, requestedPageSize: number): boolean {
  if (len >= FOCUS_NFES_RECEBIDAS_LIST_MAX_LEGACY) return true;
  return len === requestedPageSize;
}

function parseCabTotal(cab: NfeCab): number | null {
  const raw = cab.valor_total ?? cab.valor ?? cab.total ?? null;
  if (raw === null || raw === undefined) return null;
  const n = Number(String(raw).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function scheduleWaitUntil(p: Promise<unknown>): void {
  try {
    // @ts-ignore Edge
    const ER = globalThis.EdgeRuntime;
    if (ER && typeof ER.waitUntil === "function") {
      // @ts-ignore
      ER.waitUntil(p);
      return;
    }
  } catch {
    /* ignore */
  }
  void p.catch(() => undefined);
}

function kickProcessImportJobBatch(
  admin: ReturnType<typeof createClient>,
  batchId: string,
  companyId: string,
  execId: string,
  opts?: { test_single_file?: boolean },
): void {
  marcador(companyId, "FOCUS_SYNC_PROCESS_INVOKE_AGENDADO", {
    batch_id: batchId,
    exec_id: execId,
    test_single_file: opts?.test_single_file === true,
  });
  slogV("process_import_job_batch_invoke_nao_bloqueante", companyId, "waitUntil(invoke)", {
    exec_id: execId,
    batch_id: batchId,
    test_single_file: opts?.test_single_file === true,
  });

  const invokeBody = {
    batch_id: batchId,
    ...(opts?.test_single_file === true ? { test_single_file: true } : {}),
  };

  const procPromise = admin.functions
    .invoke("process-import-job-batch", { body: invokeBody })
    .then(({ data: procData, error: procErr }) => {
      if (procErr) {
        const errMsg = procErr.message ?? String(procErr);
        marcador(companyId, "FOCUS_SYNC_PROCESS_INVOKE_ERRO", {
          batch_id: batchId,
          exec_id: execId,
          erro: errMsg,
        });
        slog(
          "process_import_job_batch_invoke_ERRO",
          companyId,
          "invoke assíncrono falhou — batch pode ficar QUEUED",
          { exec_id: execId, batch_id: batchId, erro: errMsg },
        );
        return;
      }
      marcador(companyId, "FOCUS_SYNC_PROCESS_INVOKE_OK", {
        batch_id: batchId,
        exec_id: execId,
      });
      slogV(
        "process_import_job_batch_invoke_OK",
        companyId,
        "processor aceite (1.ª ronda); encadeamento interno segue no processor",
        {
          exec_id: execId,
          batch_id: batchId,
          resposta_processor: procData ?? null,
        },
      );
    })
    .catch((e) => {
      marcador(companyId, "FOCUS_SYNC_PROCESS_INVOKE_EXCECAO", {
        batch_id: batchId,
        exec_id: execId,
        erro: String(e),
      });
      console.error(LOG, String(e));
    });

  scheduleWaitUntil(procPromise);
}

async function countPendingQueue(
  admin: ReturnType<typeof createClient>,
  companyId: string,
): Promise<number> {
  const { count, error } = await admin
    .from("focus_nfe_recebidas_sync_queue")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "pending");
  if (error) {
    console.warn(LOG, "count_pending_queue", error.message);
    return 0;
  }
  return count ?? 0;
}

async function persistFocusnfe(
  admin: ReturnType<typeof createClient>,
  companyId: string,
  patch: Record<string, unknown>,
  execId: string,
  faseLog: string,
): Promise<void> {
  const { data: row, error: readErr } = await admin
    .from("companies")
    .select("focusnfe")
    .eq("id", companyId)
    .maybeSingle();
  if (readErr) {
    console.warn(LOG, "persist_focusnfe_read", readErr.message);
    return;
  }
  const prev = (row?.focusnfe ?? {}) as Record<string, unknown>;
  const nextFocus: Record<string, unknown> = { ...prev, ...patch };
  if (patch.nfes_recebidas_sync_lease_cleared === true) {
    delete nextFocus.nfes_recebidas_sync_lease_until;
    delete nextFocus.nfes_recebidas_sync_lease_cleared;
  }
  const { error: upErr } = await admin
    .from("companies")
    .update({
      focusnfe: nextFocus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", companyId);
  if (upErr) {
    slog("cursor_persist_erro", companyId, upErr.message, { exec_id: execId, fase: faseLog });
  } else {
    slogV("cursor_persist_ok", companyId, faseLog, { exec_id: execId, ...patch });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);

  const bodyRaw = await req.json().catch(() => ({}));
  const body = bodyRaw && typeof bodyRaw === "object" && !Array.isArray(bodyRaw)
    ? (bodyRaw as Record<string, unknown>)
    : {};

  const expected = Deno.env.get("FOCUS_NFE_RECEBIDAS_CRON_SECRET")?.trim();
  if (!expected) {
    return json(
      {
        ok: false,
        error:
          "Defina FOCUS_NFE_RECEBIDAS_CRON_SECRET para agendamento seguro desta função.",
      },
      503,
    );
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const isCron = bearer === expected;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const focusToken = Deno.env.get("FOCUS_NFE_TOKEN")?.trim();
  const apiBase = (
    Deno.env.get("FOCUS_NFE_API_BASE")?.trim() || "https://api.focusnfe.com.br"
  ).replace(/\/$/, "");

  if (!supabaseUrl || !anonKey || !serviceKey || !focusToken) {
    return json(
      {
        ok: false,
        error: "Variáveis Supabase ou FOCUS_NFE_TOKEN em falta.",
      },
      500,
    );
  }

  const maxCompanies = intFromEnv("FOCUS_SYNC_MAX_COMPANIES_PER_RUN", 1, 1, 500);
  let maxListPages = intFromEnv("FOCUS_SYNC_MAX_LIST_PAGES", 8, 1, 80);
  let maxXmlDownloads = intFromEnv("FOCUS_SYNC_MAX_XML_DOWNLOADS_PER_RUN", 20, 1, 500);
  const softBudgetMs = intFromEnv("FOCUS_SYNC_SOFT_BUDGET_MS", 0, 0, 600_000);
  const leaseMinutes = intFromEnv("FOCUS_SYNC_LEASE_MINUTES", 30, 1, 180);
  const activeBatchStaleMinutes = intFromEnv(
    "FOCUS_SYNC_ACTIVE_BATCH_STALE_MINUTES",
    25,
    5,
    24 * 60,
  );
  let maxChainDepth = intFromEnv("FOCUS_SYNC_MAX_CHAIN_DEPTH", 2, 0, 5);
  let listPageSize = intFromEnv("FOCUS_SYNC_LIST_PAGE_SIZE", 25, 1, 100);

  const phase = parsePhase(body.phase);
  const skipProcessImportJobBatch = body.skip_process_import_job_batch === true;
  const chainDepthReal = Number.isFinite(Number(body.chain_depth))
    ? Math.max(0, Math.floor(Number(body.chain_depth)))
    : 0;

  const cronFilterCompanyId = isCron
    ? String(body.company_id ?? "").trim()
    : "";

  const chainAuthHeader = isCron ? `Bearer ${expected}` : authHeader;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  type CoRow = { id: string; document?: string | null; focusnfe?: Record<string, unknown> };
  let companiesToProcess: CoRow[] = [];
  let isManualSingle = false;
  let manualVersaoInicial: number | undefined = undefined;
  let manualForceReimport = false;
  let manualTestMode = false;
  let manualTestSingleKey: string | null = null;

  if (isCron) {
    const { data: companies, error: listErr } = await admin
      .from("companies")
      .select("id, document, focusnfe");

    if (listErr) {
      console.error(LOG, "list_companies", listErr.message);
      return json({ ok: false, error: listErr.message }, 500);
    }
    let list = (companies ?? []) as CoRow[];
    if (cronFilterCompanyId) {
      list = list.filter((c) => String(c.id) === cronFilterCompanyId);
    }
    companiesToProcess = list;
  } else {
    if (body.manual !== true) {
      return json(
        {
          ok: false,
          error:
            "Não autorizado. Use Bearer com o secret do cron ou body { manual: true, company_id } com sessão válida.",
        },
        401,
      );
    }
    const companyIdManual = String(body.company_id ?? "").trim();
    if (!companyIdManual) {
      return json({ ok: false, error: "manual: true requer company_id (UUID da unidade)." }, 400);
    }
    if (!authHeader.startsWith("Bearer ") || !bearer) {
      return json({ ok: false, error: "Envie Authorization: Bearer <JWT da sessão>." }, 401);
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return json({ ok: false, error: "Sessão inválida. Entre novamente." }, 401);
    }
    const { data: mem, error: memErr } = await userClient
      .from("user_companies")
      .select("company_id")
      .eq("user_id", user.id)
      .eq("company_id", companyIdManual)
      .maybeSingle();
    if (memErr || !mem) {
      return json({ ok: false, error: "Sem acesso a esta unidade." }, 403);
    }
    const { data: oneRow, error: coErr } = await admin
      .from("companies")
      .select("id, document, focusnfe")
      .eq("id", companyIdManual)
      .maybeSingle();
    if (coErr || !oneRow) {
      return json({ ok: false, error: "Unidade não encontrada." }, 404);
    }
    companiesToProcess = [oneRow as CoRow];
    isManualSingle = true;
    const rawv = body.versao_inicial;
    if (rawv !== undefined && rawv !== null && String(rawv).trim() !== "") {
      const n = Number(rawv);
      if (Number.isFinite(n) && n >= 0) manualVersaoInicial = Math.floor(n);
    }
    manualForceReimport = body.force_reimport === true;
    manualTestMode = body.test_mode === true;
    const maybeTestKey = String(body.test_single_key ?? "").replace(/\D/g, "");
    manualTestSingleKey = maybeTestKey.length === 44 ? maybeTestKey : null;
  }

  if (isManualSingle) {
    const oLp = optionalBodyInt(body.max_list_pages, 1, 80);
    if (oLp !== null) maxListPages = oLp;
    const oXd = optionalBodyInt(body.max_xml_downloads, 1, 500);
    if (oXd !== null) maxXmlDownloads = oXd;
    const oCh = optionalBodyInt(body.max_chain_depth, 0, 5);
    if (oCh !== null) maxChainDepth = oCh;
    const oLps = optionalBodyInt(body.list_page_size, 1, 100);
    if (oLps !== null) listPageSize = oLps;
    if (manualTestMode) {
      maxListPages = 1;
      maxXmlDownloads = 1;
      maxChainDepth = 0;
    }
  }

  const summary: Array<Record<string, unknown>> = [];

  const eligibleLimited: CoRow[] = [];
  let eligibleSlots = 0;
  for (const row of companiesToProcess) {
    const companyId = String(row.id);
    const focusnfe = (row.focusnfe ?? {}) as Record<string, unknown>;
    const cnpjDigits = String(row.document ?? "").replace(/\D/g, "").slice(0, 14);
    if (!focusIdEmpresa(focusnfe)) {
      summary.push({
        company_id: companyId,
        skipped: "sem id_empresa Focus",
      });
      continue;
    }
    if (cnpjDigits.length !== 14) {
      summary.push({
        company_id: companyId,
        skipped: "document sem CNPJ 14 dígitos",
      });
      continue;
    }
    if (eligibleSlots >= maxCompanies) continue;
    eligibleSlots += 1;
    eligibleLimited.push(row);
  }
  companiesToProcess = eligibleLimited;

  const execId = crypto.randomUUID();
  const iniciadoEm = new Date().toISOString();
  const t0 = performance.now();

  slog("execucao_inicio", null, "POST aceite", {
    exec_id: execId,
    api_base: apiBase,
    iniciado_em: iniciadoEm,
    modo: isCron ? "cron" : "manual_unidade",
    phase,
    caps: {
      maxCompanies,
      maxListPages,
      maxXmlDownloads,
      listPageSize,
      softBudgetMs,
      leaseMinutes,
      maxChainDepth,
    },
    chain_depth: chainDepthReal,
  });

  let totalPaginas = 0;
  let totalCabecalhos = 0;
  let totalEnfileirados = 0;
  let totalXmlOk = 0;
  let listaIncompletaGlobal = false;
  let pendingAfterGlobal = 0;

  for (const row of companiesToProcess) {
    const companyId = String(row.id);
    let focusnfe = ((row.focusnfe ?? {}) as Record<string, unknown>);
    const cnpjDigits = String(row.document ?? "").replace(/\D/g, "").slice(0, 14);

    const leaseIso = typeof focusnfe.nfes_recebidas_sync_lease_until === "string"
      ? focusnfe.nfes_recebidas_sync_lease_until
      : "";
    if (!isManualSingle && leaseIso) {
      const t = Date.parse(leaseIso);
      if (Number.isFinite(t) && t > Date.now()) {
        slog("empresa_ignorada_lease", companyId, "lease ativo", {
          exec_id: execId,
          ate: leaseIso,
        });
        summary.push({
          company_id: companyId,
          skipped: "lease ativo (outra execução cron)",
          nfes_recebidas_sync_lease_until: leaseIso,
        });
        continue;
      }
    }

    const storedRaw = Number(focusnfe.nfes_recebidas_ultima_versao);
    const cursorPersistido =
      Number.isFinite(storedRaw) && storedRaw >= 0 ? Math.floor(storedRaw) : 0;
    let cursor =
      isManualSingle && manualVersaoInicial !== undefined
        ? manualVersaoInicial
        : cursorPersistido;

    slogV("empresa_inicio", companyId, "início", {
      exec_id: execId,
      cnpj: cnpjDigits,
      versao_cursor_inicial: cursor,
      phase,
    });

    const { data: ownerRow } = await admin
      .from("user_companies")
      .select("user_id")
      .eq("company_id", companyId)
      .eq("role", "owner")
      .maybeSingle();

    let requestedBy: string | null = ownerRow?.user_id ?? null;
    if (!requestedBy) {
      const { data: anyMem } = await admin
        .from("user_companies")
        .select("user_id")
        .eq("company_id", companyId)
        .limit(1)
        .maybeSingle();
      requestedBy = anyMem?.user_id ?? null;
    }
    if (!requestedBy) {
      summary.push({
        company_id: companyId,
        skipped: "sem membro para requested_by no lote",
      });
      continue;
    }

    if (!isManualSingle) {
      const leaseUntil = new Date(Date.now() + leaseMinutes * 60_000).toISOString();
      await persistFocusnfe(
        admin,
        companyId,
        { nfes_recebidas_sync_lease_until: leaseUntil },
        execId,
        "lease_inicio",
      );
      focusnfe = { ...focusnfe, nfes_recebidas_sync_lease_until: leaseUntil };
    }

    const runList = phase === "list" || phase === "auto";
    const runDownload = phase === "download" || phase === "auto";

    let paginasEste = 0;
    let cabecalhosEste = 0;
    let enfileiradosEste = 0;
    let reativadosFilaEste = 0;
    let bloqueadosBatchAtivoEste = 0;
    let cabecalhosImportaveisEste = 0;
    let descartadosJaImportadosEste = 0;
    const xmlsIdentificadosEste: Array<Record<string, unknown>> = [];
    let listaIncompleta = false;
    let listError: string | null = null;
    const tList0 = performance.now();

    const seenChaveListCycle = new Set<string>();

    if (runList && manualTestMode && manualTestSingleKey) {
      const testKey = manualTestSingleKey;
      const seenChaveListCycle = new Set<string>();
      const toEnqueue: Array<{ chave: string; versao: number | null }> = [];
      if (!seenChaveListCycle.has(testKey)) {
        seenChaveListCycle.add(testKey);
        toEnqueue.push({ chave: testKey, versao: null });
      }
      cabecalhosImportaveisEste += toEnqueue.length;
      cabecalhosEste += toEnqueue.length;
      totalCabecalhos += toEnqueue.length;
      if (toEnqueue.length > 0) {
        const rows = toEnqueue.map((x) => ({
          company_id: companyId,
          nfe_access_key: x.chave,
          versao: x.versao,
          status: "pending",
        }));
        let inserted = 0;
        for (const rowToInsert of rows) {
          const { error: insErr } = await admin
            .from("focus_nfe_recebidas_sync_queue")
            .insert(rowToInsert);
          if (!insErr) inserted += 1;
          else if (!String(insErr.message).toLowerCase().includes("duplicate") && insErr.code !== "23505") {
            console.warn(LOG, "queue_insert_test_mode", insErr.message);
          }
        }
        enfileiradosEste += inserted;
        totalEnfileirados += inserted;
      }
      slogV("test_mode_single_key_queue", companyId, "chave única enfileirada para teste", {
        exec_id: execId,
        chave_nfe_44: testKey,
        enfileirados: enfileiradosEste,
      });
    } else if (runList) {
      let runs = 0;
      while (runs < maxListPages) {
        if (budgetExceeded(t0, softBudgetMs)) {
          slog("orcamento_soft_stop", companyId, "FOCUS_SYNC_SOFT_BUDGET_MS (list)", {
            exec_id: execId,
          });
          listaIncompleta = true;
          break;
        }

        runs += 1;
        const cursorAntesLista = cursor;
        const listUrl =
          `${apiBase}/v2/nfes_recebidas?cnpj=${encodeURIComponent(cnpjDigits)}&versao=${cursor}&limite=${listPageSize}`;

        let listRes: Response;
        try {
          listRes = await fetch(listUrl, {
            method: "GET",
            headers: {
              Authorization: focusBasicAuthHeader(focusToken),
              Accept: "application/json",
            },
          });
        } catch (e) {
          console.error(LOG, "fetch lista", companyId, e);
          listError = "falha de rede lista Focus";
          break;
        }

        const listText = await listRes.text();
        let lista: unknown;
        try {
          lista = listText ? JSON.parse(listText) : [];
        } catch {
          listError = `HTTP ${listRes.status} lista NF-e (JSON inválido)`;
          break;
        }

        if (!Array.isArray(lista)) {
          listError = `resposta lista inesperada ${listRes.status}`;
          break;
        }

        const hdrMaxRaw = listRes.headers.get("X-Max-Version");
        const hdrMax = hdrMaxRaw != null ? Number(hdrMaxRaw) : NaN;

        if (lista.length === 0) {
          if (Number.isFinite(hdrMax) && hdrMax > cursor) {
            cursor = Math.floor(hdrMax);
          }
          paginasEste += 1;
          totalPaginas += 1;
          await persistFocusnfe(
            admin,
            companyId,
            {
              nfes_recebidas_ultima_versao: cursor,
            },
            execId,
            "checkpoint_lista_vazia",
          );
          slogV("lista_focus_pagina", companyId, "página vazia — fim", {
            exec_id: execId,
            run: runs,
            versao_cursor_saida: cursor,
          });
          break;
        }

        const cabList = lista as NfeCab[];
        const cabListForQueue = limitCabListForManualTest(cabList, {
          isManualSingle,
          manualTestMode,
          manualTestSingleKey,
          maxImportable: maxXmlDownloads,
        });
        paginasEste += 1;
        totalPaginas += 1;
        cabecalhosEste += cabList.length;
        totalCabecalhos += cabList.length;

        let pageMaxVers = cursor;
        for (const cab of cabList) {
          const v = Number(cab.versao);
          if (Number.isFinite(v) && v > pageMaxVers) pageMaxVers = Math.floor(v);
        }
        if (Number.isFinite(hdrMax) && hdrMax > pageMaxVers) {
          pageMaxVers = Math.floor(hdrMax);
        }
        cursor = pageMaxVers;

        await persistFocusnfe(
          admin,
          companyId,
          { nfes_recebidas_ultima_versao: cursor },
          execId,
          "checkpoint_lista_pagina",
        );

        slogV(
          "lista_focus_pagina",
          companyId,
          manualTestMode && isManualSingle && !manualTestSingleKey
            ? `página Focus ${cabList.length} itens → fila ${cabListForQueue.length} importável(is) (cap teste=${maxXmlDownloads})`
            : `${cabList.length} cabeçalhos`,
          {
            exec_id: execId,
            run: runs,
            proxima_consulta_versao: cursor,
            itens_pagina_focus: cabList.length,
            cabecalhos_para_enfileiramento: cabListForQueue.length,
          },
        );

        const toEnqueue: Array<{ chave: string; versao: number | null }> = [];
        for (const cab of cabListForQueue) {
          const chave = String(cab.chave_nfe ?? "").replace(/\D/g, "");
          if (chave.length !== 44) continue;
          if (!nfeRecebidaImportavel(cab)) continue;
          cabecalhosImportaveisEste += 1;
          if (xmlsIdentificadosEste.length < 80) {
            xmlsIdentificadosEste.push({
              chave_nfe: chave,
              versao: Number.isFinite(Number(cab.versao)) ? Number(cab.versao) : null,
              situacao: String(cab.situacao ?? "").trim() || null,
              fornecedor_nome: String(cab.nome_emitente ?? "").trim() || null,
              valor_total: parseCabTotal(cab),
            });
          }
          if (seenChaveListCycle.has(chave)) continue;
          seenChaveListCycle.add(chave);
          const v = Number(cab.versao);
          toEnqueue.push({
            chave,
            versao: Number.isFinite(v) ? Math.floor(v) : null,
          });
        }

        if (toEnqueue.length > 0) {
          const chaves = toEnqueue.map((x) => x.chave);
          const keysKnown = new Set<string>();
          if (!(isManualSingle && manualForceReimport)) {
            const chunkSz = 120;
            for (let i = 0; i < chaves.length; i += chunkSz) {
              const part = chaves.slice(i, i + chunkSz);
              const { data: existingKeys } = await admin
                .from("company_nfe_import_logs")
                .select("nfe_access_key, expense_id")
                .eq("company_id", companyId)
                .in("nfe_access_key", part);
              const expenseIds = (existingKeys ?? [])
                .map((r) => String((r as { expense_id?: string | null }).expense_id ?? "").trim())
                .filter((x) => x.length > 0);
              const existingExpenseIds = new Set<string>();
              if (expenseIds.length > 0) {
                const { data: expRows } = await admin
                  .from("expenses")
                  .select("id")
                  .eq("company_id", companyId)
                  .in("id", expenseIds);
                for (const er of expRows ?? []) {
                  const id = String((er as { id?: string }).id ?? "").trim();
                  if (id) existingExpenseIds.add(id);
                }
              }
              for (const r of existingKeys ?? []) {
                const row = r as {
                  nfe_access_key?: string;
                  expense_id?: string | null;
                };
                const k = row.nfe_access_key;
                if (!k) continue;
                // Só bloqueia quando a despesa ainda existe de fato.
                const expId = String(row.expense_id ?? "").trim();
                if (expId && existingExpenseIds.has(expId)) {
                  keysKnown.add(k);
                }
              }
            }
          }

          const rows = toEnqueue
            .filter((x) => !keysKnown.has(x.chave))
            .map((x) => ({
              company_id: companyId,
              nfe_access_key: x.chave,
              versao: x.versao,
              status: "pending",
            }));
          descartadosJaImportadosEste += (toEnqueue.length - rows.length);

          // Alguns itens podem já existir na fila com estados terminais (ex.: failed/skipped_duplicate)
          // e nunca mais voltar para claim. Reativamos para pending quando apropriado.
          const rowsByKey = new Map(rows.map((r) => [r.nfe_access_key, r]));
          const rowsKeys = [...rowsByKey.keys()];
          if (rowsKeys.length > 0) {
            const batchActivityCache = new Map<string, boolean>();
            const { data: queueExisting } = await admin
              .from("focus_nfe_recebidas_sync_queue")
              .select("id, nfe_access_key, status, batch_id")
              .eq("company_id", companyId)
              .in("nfe_access_key", rowsKeys);

            for (const ex of queueExisting ?? []) {
              const q = ex as {
                id: string;
                nfe_access_key?: string;
                status?: string;
                batch_id?: string | null;
              };
              const key = String(q.nfe_access_key ?? "").trim();
              if (!key) continue;
              const st = String(q.status ?? "").toLowerCase();
              // Não mexe em itens realmente ativos.
              if (st === "pending" || st === "processing") {
                rowsByKey.delete(key);
                continue;
              }
              if (st === "in_batch") {
                const bid = String(q.batch_id ?? "").trim();
                if (bid) {
                  const { data: batchRow } = await admin
                    .from("import_job_batches")
                    .select("status, updated_at, created_at")
                    .eq("id", bid)
                    .maybeSingle();
                  const bst = String(batchRow?.status ?? "").toUpperCase();
                  const batchAtivo = bst === "QUEUED" || bst === "PROCESSING";
                  const tUpdated = Date.parse(String(batchRow?.updated_at ?? ""));
                  const tCreated = Date.parse(String(batchRow?.created_at ?? ""));
                  const tBase = Number.isFinite(tUpdated)
                    ? tUpdated
                    : Number.isFinite(tCreated)
                      ? tCreated
                      : NaN;
                  const activeAgeMs = Number.isFinite(tBase) ? Date.now() - tBase : 0;
                  const ativoMasStale = batchAtivo &&
                    activeAgeMs > activeBatchStaleMinutes * 60_000;
                  let batchTemArquivosAtivos = false;
                  if (batchAtivo) {
                    if (batchActivityCache.has(bid)) {
                      batchTemArquivosAtivos = batchActivityCache.get(bid) === true;
                    } else {
                      const { count: cActiveFiles } = await admin
                        .from("import_job_files")
                        .select("id", { count: "exact", head: true })
                        .eq("batch_id", bid)
                        .in("status", ["QUEUED", "PROCESSING"]);
                      batchTemArquivosAtivos = (cActiveFiles ?? 0) > 0;
                      batchActivityCache.set(bid, batchTemArquivosAtivos);
                    }
                  }
                  const ativoSemArquivos = batchAtivo && !batchTemArquivosAtivos;
                  if (batchAtivo) {
                    if (ativoMasStale || ativoSemArquivos) {
                      slogV(
                        "queue_reactivate_stale_in_batch",
                        companyId,
                        "in_batch preso em batch ativo stale/inconsistente — reativar pending",
                        {
                          exec_id: execId,
                          batch_id: bid,
                          batch_status: bst,
                          active_age_ms: activeAgeMs,
                          stale_threshold_min: activeBatchStaleMinutes,
                          active_files: batchTemArquivosAtivos ? 1 : 0,
                          nfe_access_key: key,
                        },
                      );
                    } else {
                      bloqueadosBatchAtivoEste += 1;
                      rowsByKey.delete(key);
                      continue;
                    }
                  }
                  if (batchAtivo && !ativoMasStale && !ativoSemArquivos) {
                    bloqueadosBatchAtivoEste += 1;
                    rowsByKey.delete(key);
                    continue;
                  }
                }
              }
              const rowData = rowsByKey.get(key);
              const { error: reactErr } = await admin
                .from("focus_nfe_recebidas_sync_queue")
                .update({
                  status: "pending",
                  versao: rowData?.versao ?? null,
                  batch_id: null,
                  last_error: null,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", q.id);
              if (!reactErr) {
                reativadosFilaEste += 1;
                rowsByKey.delete(key);
              } else {
                console.warn(LOG, "queue_reactivate", reactErr.message);
              }
            }
          }

          const rowsToInsert = [...rowsByKey.values()];

          if (rowsToInsert.length > 0) {
            let inserted = 0;
            for (const row of rowsToInsert) {
              const { error: insErr } = await admin
                .from("focus_nfe_recebidas_sync_queue")
                .insert(row);
              if (!insErr) inserted += 1;
              else if (!String(insErr.message).toLowerCase().includes("duplicate") && insErr.code !== "23505") {
                console.warn(LOG, "queue_insert", insErr.message);
              }
            }
            enfileiradosEste += inserted;
            totalEnfileirados += inserted;
          }
        }

        const listaLen = lista.length;
        if (
          listaLen < FOCUS_NFES_RECEBIDAS_LIST_MAX_LEGACY &&
          listaLen !== listPageSize
        ) {
          break;
        }

        if (runs >= maxListPages) {
          listaIncompleta = listFocusPageIsFull(listaLen, listPageSize);
          if (listaIncompleta) {
            slogV("lista_focus_cap", companyId, `MAX_LIST_PAGES=${maxListPages}`, {
              exec_id: execId,
            });
          }
          break;
        }
      }
    }

    const elapsedListMs = Math.round(performance.now() - tList0);
    if (listError) {
      summary.push({ company_id: companyId, error: listError });
      await persistFocusnfe(
        admin,
        companyId,
        {
          nfes_recebidas_sync_lease_cleared: true,
        },
        execId,
        "lease_fim_erro_lista",
      );
      continue;
    }

    if (listaIncompleta) listaIncompletaGlobal = true;

    let batchIdOut: string | null = null;
    let filesInserted = 0;
    const tDl0 = performance.now();

    if (runDownload) {
      if (budgetExceeded(t0, softBudgetMs)) {
        slog("orcamento_soft_stop", companyId, "antes download", { exec_id: execId });
      } else {
        const { data: claimed, error: claimErr } = await admin.rpc(
          "claim_focus_nfe_recebidas_queue",
          {
            p_company_id: companyId,
            p_limit: maxXmlDownloads,
          },
        );

        if (claimErr) {
          console.error(LOG, "claim_queue", claimErr.message);
          summary.push({
            company_id: companyId,
            error: `claim fila: ${claimErr.message}`,
          });
        } else {
          const claimedRows = (claimed ?? []) as QueueRow[];
          const claimedIds = claimedRows.map((r) => r.id);
          const settledQueueIds = new Set<string>();
          const xmlGapMs = throttleMsForSyncRun(manualTestMode);
          const toFetch: Array<{
            queueId: string;
            cab: NfeCab;
            xml: Uint8Array;
            hash: string;
          }> = [];
          const seenXmlHashThisBatch = new Set<string>();
          let xmlFetchIndex = 0;

          for (const qrow of claimedRows) {
            if (budgetExceeded(t0, softBudgetMs)) break;
            const chave = qrow.nfe_access_key;
            const cab: NfeCab = {
              chave_nfe: chave,
              versao: qrow.versao ?? undefined,
              situacao: "autorizada",
              nfe_completa: true,
            };

            if (xmlFetchIndex++ > 0 && xmlGapMs > 0) await sleep(xmlGapMs);

            const xmlUrl =
              `${apiBase}/v2/nfes_recebidas/${encodeURIComponent(chave)}.xml?cnpj=${encodeURIComponent(cnpjDigits)}`;
            const got = await fetchNfeRecebidaXmlWithRetry(xmlUrl, focusToken, chave);
            if (!got.ok) {
              const failPending = qrow.attempt_count < QUEUE_MAX_ATTEMPTS_FAIL;
              await admin
                .from("focus_nfe_recebidas_sync_queue")
                .update({
                  status: failPending ? "pending" : "failed",
                  last_error: `xml HTTP ${got.status}`,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", qrow.id);
              settledQueueIds.add(qrow.id);
              continue;
            }

            const xmlBuf = got.buf;
            const head = new TextDecoder()
              .decode(xmlBuf.subarray(0, Math.min(200, xmlBuf.length)))
              .toLowerCase();
            if (!(head.includes("nfe") || head.includes("nfeproc"))) {
              await admin
                .from("focus_nfe_recebidas_sync_queue")
                .update({
                  status: "failed",
                  last_error: "corpo não parece NF-e",
                  updated_at: new Date().toISOString(),
                })
                .eq("id", qrow.id);
              settledQueueIds.add(qrow.id);
              continue;
            }

            const h = await sha256Hex(xmlBuf);
            if (seenXmlHashThisBatch.has(h)) {
              await admin
                .from("focus_nfe_recebidas_sync_queue")
                .update({
                  status: "skipped_duplicate",
                  last_error: "hash duplicado no batch",
                  updated_at: new Date().toISOString(),
                })
                .eq("id", qrow.id);
              settledQueueIds.add(qrow.id);
              continue;
            }
            seenXmlHashThisBatch.add(h);
            totalXmlOk += 1;
            toFetch.push({ queueId: qrow.id, cab, xml: xmlBuf, hash: h });
            slogV("xml_transferido_focus_ok", companyId, "XML para batch", {
              exec_id: execId,
              chave_nfe_44: chave,
              bytes: xmlBuf.length,
            });
          }

          const toFetchIds = new Set(toFetch.map((t) => t.queueId));
          for (const qid of claimedIds) {
            if (!settledQueueIds.has(qid) && !toFetchIds.has(qid)) {
              await admin
                .from("focus_nfe_recebidas_sync_queue")
                .update({
                  status: "pending",
                  last_error: "interrompido (orçamento ou fim da fatia)",
                  updated_at: new Date().toISOString(),
                })
                .eq("id", qid)
                .eq("status", "processing");
            }
          }

          if (toFetch.length > 0) {
            const { data: batchRow, error: batchErr } = await admin
              .from("import_job_batches")
              .insert({
                company_id: companyId,
                requested_by: requestedBy,
                source_file_name: `focus_nfes_recebidas_${new Date().toISOString()}`,
                status: "QUEUED",
                total_files: toFetch.length,
                processed_files: 0,
                success_files: 0,
                failed_files: 0,
                pending_review_files: 0,
                progress_percent: 0,
              })
              .select("id")
              .single();

            if (batchErr || !batchRow?.id) {
              console.error(LOG, "batch_insert", batchErr?.message ?? "null");
              for (const t of toFetch) {
                await admin
                  .from("focus_nfe_recebidas_sync_queue")
                  .update({
                    status: "pending",
                    last_error: batchErr?.message ?? "batch",
                    updated_at: new Date().toISOString(),
                  })
                  .eq("id", t.queueId);
              }
              summary.push({
                company_id: companyId,
                error: batchErr?.message ?? "batch",
              });
            } else {
              batchIdOut = String(batchRow.id);
              const fileRows = toFetch.map(({ cab, xml, hash }) => ({
                batch_id: batchIdOut,
                company_id: companyId,
                file_name: `${cab.chave_nfe}.xml`,
                xml_hash: hash,
                xml_content_base64: base64FromBytes(xml),
                status: "QUEUED",
              }));

              const { error: filesErr } = await admin
                .from("import_job_files")
                .insert(fileRows);

              if (filesErr) {
                console.error(LOG, "files_insert", filesErr.message);
                await admin
                  .from("import_job_batches")
                  .update({
                    status: "FAILED",
                    last_error: filesErr.message,
                    finished_at: new Date().toISOString(),
                  })
                  .eq("id", batchIdOut);
                for (const t of toFetch) {
                  await admin
                    .from("focus_nfe_recebidas_sync_queue")
                    .update({
                      status: "pending",
                      last_error: filesErr.message,
                      updated_at: new Date().toISOString(),
                    })
                    .eq("id", t.queueId);
                }
                summary.push({
                  company_id: companyId,
                  error: filesErr.message,
                });
                batchIdOut = null;
              } else {
                filesInserted = toFetch.length;
                const qids = toFetch.map((t) => t.queueId);
                await admin
                  .from("focus_nfe_recebidas_sync_queue")
                  .update({
                    status: "in_batch",
                    batch_id: batchIdOut,
                    updated_at: new Date().toISOString(),
                  })
                  .in("id", qids);

                marcador(companyId, "FOCUS_SYNC_LOTE_ENFILEIRADO", {
                  batch_id: batchIdOut,
                  arquivos: filesInserted,
                  exec_id: execId,
                });
                if (skipProcessImportJobBatch) {
                  slogV(
                    "process_import_job_batch_invoke_skip",
                    companyId,
                    "skip_process_import_job_batch=true — invoke do batch processor desativado",
                    { exec_id: execId, batch_id: batchIdOut },
                  );
                } else {
                  kickProcessImportJobBatch(admin, batchIdOut!, companyId, execId, {
                    test_single_file: isManualSingle && manualTestMode,
                  });
                }
              }
            }
          }
        }
      }
    }

    const elapsedDownloadMs = Math.round(performance.now() - tDl0);
    const proximaSyncAt = new Date().toISOString();
    await persistFocusnfe(
      admin,
      companyId,
      {
        nfes_recebidas_ultima_sync_at: proximaSyncAt,
        nfes_recebidas_ultima_versao: cursor,
        nfes_recebidas_sync_lease_cleared: true,
      },
      execId,
      "lease_fim_ok",
    );

    const pendingRem = await countPendingQueue(admin, companyId);
    pendingAfterGlobal = pendingRem;

    const linhaSumario = {
      company_id: companyId,
      cnpj: cnpjDigits,
      phase,
      paginas_listadas: paginasEste,
      cabecalhos_vistos: cabecalhosEste,
      cabecalhos_importaveis: cabecalhosImportaveisEste,
      descartados_ja_importados: descartadosJaImportadosEste,
      filas_inseridas_este_ciclo: enfileiradosEste,
      filas_reativadas_este_ciclo: reativadosFilaEste,
      filas_bloqueadas_em_batch_ativo_este_ciclo: bloqueadosBatchAtivoEste,
      novos_xml_batch: filesInserted,
      batch_id: batchIdOut,
      cursor_versao: cursor,
      lista_incompleta: listaIncompleta,
      pending_queue_remaining: pendingRem,
      elapsed_ms_list: elapsedListMs,
      elapsed_ms_download: elapsedDownloadMs,
      xmls_identificados_preview: xmlsIdentificadosEste,
    };
    summary.push(linhaSumario);

    slogV("empresa_fim_resumo_linha", companyId, "fim", {
      exec_id: execId,
      ...linhaSumario,
    });
  }

  const elapsedTotalMs = Math.round(performance.now() - t0);
  const singleCompanyId = companiesToProcess.length === 1
    ? String(companiesToProcess[0]!.id)
    : "";

  const continuar =
    (listaIncompletaGlobal || pendingAfterGlobal > 0) &&
    chainDepthReal < maxChainDepth &&
    singleCompanyId !== "" &&
    (isManualSingle || cronFilterCompanyId !== "" || maxCompanies === 1);

  if (continuar) {
    const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/focus-sync-nfe-recebidas`;
    const chainBody = isCron
      ? {
        phase: "auto",
        company_id: singleCompanyId,
        chain_depth: chainDepthReal + 1,
      }
      : {
        manual: true,
        company_id: singleCompanyId,
        phase: "auto",
        chain_depth: chainDepthReal + 1,
      };
    const chainPromise = fetch(url, {
      method: "POST",
      headers: {
        Authorization: chainAuthHeader,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chainBody),
    }).catch((e) => console.warn(LOG, "chain_fetch", String(e)));

    scheduleWaitUntil(chainPromise);
    slogV("continuacao_agendada", null, "waitUntil(chain POST)", {
      exec_id: execId,
      company_id: singleCompanyId,
      chain_depth_next: chainDepthReal + 1,
      is_manual_chain: !isCron,
    });
  }

  slog("execucao_fim", null, "concluído", {
    exec_id: execId,
    empresas_no_detail: summary.length,
    iniciado_em: iniciadoEm,
    terminado_em: new Date().toISOString(),
    elapsed_ms_total: elapsedTotalMs,
    totais: {
      paginas_listadas: totalPaginas,
      cabecalhos_vistos: totalCabecalhos,
      filas_inseridas: totalEnfileirados,
      xml_descarregados_ok: totalXmlOk,
    },
    caps_aplicados: {
      maxCompanies,
      maxListPages,
      maxXmlDownloads,
      listPageSize,
      softBudgetMs,
    },
    continuacao: {
      lista_incompleta: listaIncompletaGlobal,
      pending_queue_remaining: pendingAfterGlobal,
      chain_scheduled: continuar,
      chain_depth_next: continuar ? chainDepthReal + 1 : null,
    },
  });

  if (VERBOSE_LOGS) {
    console.log(
      LOG,
      `${JSON.stringify({ exec_id: execId, resultado_resumo_json: summary })}`,
    );
  }

  return json({
    ok: true,
    exec_id: execId,
    companies: summary.length,
    detail: summary,
    metrics: {
      elapsed_ms_total: elapsedTotalMs,
      paginas_listadas: totalPaginas,
      cabecalhos_vistos: totalCabecalhos,
      filas_inseridas: totalEnfileirados,
      xml_descarregados_ok: totalXmlOk,
    },
    caps_aplicados: {
      maxCompanies,
      maxListPages,
      maxXmlDownloads,
      listPageSize,
      softBudgetMs,
    },
    continuacao: {
      lista_incompleta: listaIncompletaGlobal,
      pending_queue_remaining: pendingAfterGlobal,
      chain_scheduled: continuar,
      mensagem:
        continuar || listaIncompletaGlobal || pendingAfterGlobal > 0
          ? "A sincronização pode continuar em chamadas seguintes (cron ou encadeamento automático)."
          : undefined,
    },
  });
});

// @ts-nocheck
/**
 *
 * Listagem **resumida** de NF-e recebidas na Focus (`GET /v2/nfes_recebidas`), usando
 * `x-total-count` e `x-max-version` nos headers para paginação. Apenas notas com
 * `nfe_completa` explicitamente verdadeiro são gravadas em `focus_get_sync_nfe_staging`.
 *
 * **Cron:** `Authorization: Bearer <FOCUS_NFE_RECEBIDAS_CRON_SECRET>` (mesmo secret da sync completa).
 * Body opcional: `{ "company_id": "<uuid>" }` para uma unidade.
 *
 * **Manual:** `{ "manual": true, "company_id": "<uuid>" }` + `Authorization: Bearer <JWT>`.
 * Opcional: `versao` (número inicial do cursor; senão usa `focusnfe.nfes_recebidas_ultima_versao` ou 0).
 * Opcional: `onboarding: true` — fluxo de onboarding fiscal: `max_nfes_sync` = XMLs a interpretar;
 * `sync` só passa a `false` se a listagem Focus terminar sem XML em staging, ou quando o job de interpretação
 * (`focus-get-sync-nfe-interpret-staging`) marcar `status=done` após processar todos os XMLs.
 * `nfes_sync` na interpretação segue o offset do job (teto = `max_nfes_sync`), não soma +5 por chunk.
 * Em falha transitória (rede/5xx), grava `sefaz_unavailable` + `sefaz_retry_at` (retry pg_cron 30 min).
 * Opcional: `onboarding_retry: true` — retry automático (não repõe métricas; limpa `sefaz_unavailable` ao iniciar).
 * Com `onboarding` / `onboarding_retry`, ignora unidades com `onboarding_fiscal.completed` ou fora da fase de listagem (`sync: false`).
 * Sem onboarding explícito no body, unidades em onboarding pendente (fase de listagem) com
 * **primeira** sync (`nfes_recebidas_ultima_sync_at` ausente) entram com prioridade (tier 0);
 * onboarding pendente que já sincronizou ao menos uma vez entra no rodízio (tier 2), como as demais.
 * Cron automático (secret, sem `manual: true`): não lista na Focus se a unidade tiver job em
 * `focus_get_sync_nfe_interpret_jobs` com `status` `pending` ou `processing` (interpretação em andamento).
 * Rodízio cron (fora onboarding/retry/manual): só empresas sem `nfes_recebidas_ultima_sync_at` ou com
 * última sync há ≥ 12 h. Ao reservar a unidade no run, grava `nfes_recebidas_ultima_sync_at` de imediato
 * (antes do GET na Focus) para o próximo disparo não repetir a mesma empresa.
 * Após sync OK, persiste `nfes_recebidas_ultima_versao` e `nfes_recebidas_ultima_sync_at` no JSON `focusnfe`.
 *
 * Env: `SUPABASE_*`, `FOCUS_NFE_TOKEN`, `FOCUS_NFE_API_BASE` (opcional), `FOCUS_GET_SYNC_MAX_COMPANIES_PER_RUN` (default 1),
 * `FOCUS_GET_SYNC_MAX_PAGES` (default 80). O tamanho da página de resultados é o definido pela API Focus (sem `limite` na query).
 * Para cada nota gravada, faz download do XML em **blocos paralelos de 10** (`GET .../{chave}.xml`);
 * entre blocos aplica `FOCUS_NFE_XML_THROTTLE_MS` (default 450 ms).
 * Com pelo menos uma linha em `focus_get_sync_nfe_staging` com XML, enfileira `focus_get_sync_nfe_interpret_jobs`
 * (`staging_xml_total` = total de XMLs; `staging_process_offset` = progresso).
 * Catálogo global de fornecedores (`unified_supplier_*`) roda em `focus-get-sync-nfe-interpret-staging`, não aqui
 * (evita CPU Time exceeded ao parsear cada XML nesta função).
 * (com `onboarding` quando o body pediu `onboarding: true`).
 * (processamento assíncrono via pg_cron → `focus-get-sync-nfe-interpret-staging`).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const LOG = "[focus-get-sync-nfe]";

/** Downloads de XML em paralelo por lote; throttle só entre lotes. */
const XML_DOWNLOAD_PARALLEL = 10;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
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

function intFromEnv(
  name: string,
  defaultVal: number,
  min: number,
  max: number,
): number {
  const raw = Deno.env.get(name)?.trim();
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return defaultVal;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function focusBasicAuthHeader(token: string): string {
  const pair = `${token.trim()}:`;
  let binary = "";
  for (let i = 0; i < pair.length; i++) {
    binary += String.fromCharCode(pair.charCodeAt(i));
  }
  return `Basic ${btoa(binary)}`;
}

function focusIdEmpresa(raw: Record<string, unknown> | undefined): unknown {
  const v = raw?.id_empresa;
  if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  return null;
}

/** Só aceita `nfe_completa` explicitamente verdadeiro (não trata omissão como true). */
function isNfeCompletaExplicitTrue(raw: unknown): boolean {
  if (raw === true) return true;
  if (raw === 1) return true;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "sim" || s === "yes") return true;
  }
  return false;
}

function intHeader(res: Response, canonical: string): number | null {
  const raw = res.headers.get(canonical);
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => globalThis.setTimeout(r, ms));
}

function throttleMsBetweenXmlDownloads(): number {
  const raw = Deno.env.get("FOCUS_NFE_XML_THROTTLE_MS")?.trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return 450;
}

function retryAfterDelayMs(res: Response): number | null {
  const raw = res.headers.get("Retry-After")?.trim();
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 300_000);
  const deadline = Date.parse(raw);
  if (Number.isFinite(deadline)) {
    const w = deadline - Date.now();
    if (Number.isFinite(w))
      return Math.min(Math.max(0, Math.floor(w)), 300_000);
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

type CoRow = {
  id: string;
  document?: string | null;
  focusnfe?: Record<string, unknown>;
  onboarding_fiscal?: unknown;
};

/** Onboarding fiscal ainda não concluído (`completed` ≠ true). */
function isOnboardingFiscalPending(raw: unknown): boolean {
  return !normalizeOnboardingFiscal(raw).completed;
}

/**
 * Fase de listagem/sync na SEFAZ (`sync` ativo ou ausente).
 * Com `sync: false`, a listagem já terminou e aguarda interpretação/confirmação.
 */
function isOnboardingFiscalListSyncPhase(raw: unknown): boolean {
  if (!isOnboardingFiscalPending(raw)) return false;
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return o["sync"] !== false;
}

/** Resumo compacto de `onboarding_fiscal` para logs. */
function summarizeOnboardingFiscal(raw: unknown): Record<string, unknown> {
  const norm = normalizeOnboardingFiscal(raw);
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    completed: norm.completed,
    sync: norm.sync,
    pending: isOnboardingFiscalPending(raw),
    list_sync_phase: isOnboardingFiscalListSyncPhase(raw),
    max_nfes_sync: norm.max_nfes_sync,
    nfes_sync: norm.nfes_sync,
    nfes_ignored: norm.nfes_ignored,
    sefaz_unavailable: o["sefaz_unavailable"] === true,
    sefaz_retry_at:
      typeof o["sefaz_retry_at"] === "string" ? o["sefaz_retry_at"] : null,
  };
}

function logPhase(phase: string, payload: Record<string, unknown>): void {
  console.log(LOG, JSON.stringify({ fase: phase, ...payload }));
}

function nfesRecebidasUltimaSyncAtMs(row: CoRow): number {
  const focusnfe = (row.focusnfe ?? {}) as Record<string, unknown>;
  const raw = focusnfe.nfes_recebidas_ultima_sync_at;
  if (typeof raw !== "string" || !raw.trim()) return 0;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

/** Intervalo mínimo entre syncs no rodízio cron (empresas fora onboarding/retry/manual). */
const NFES_RECEBIDAS_SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000;

function isNfesRecebidasSyncIntervalDue(row: CoRow): boolean {
  const lastMs = nfesRecebidasUltimaSyncAtMs(row);
  if (lastMs === 0) return true;
  return Date.now() - lastMs >= NFES_RECEBIDAS_SYNC_INTERVAL_MS;
}

function shouldGateNfesRecebidasSyncInterval(
  bodyOnboarding: boolean,
  bodyOnboardingRetry: boolean,
  pending: boolean,
  bypassSyncInterval: boolean,
): boolean {
  if (bypassSyncInterval || bodyOnboarding || bodyOnboardingRetry || pending) {
    return false;
  }
  return true;
}

type ClassifyCompanyResult = {
  include: boolean;
  skip?: string;
  tier: number;
  effectiveOnboarding: boolean;
  resetOnboardingMetrics: boolean;
  clearSefazRetry: boolean;
};

function applyNfesRecebidasSyncIntervalGate(
  row: CoRow,
  gate: boolean,
  result: ClassifyCompanyResult,
): ClassifyCompanyResult {
  if (!result.include || !gate || isNfesRecebidasSyncIntervalDue(row)) {
    return result;
  }
  return {
    include: false,
    skip: "última sync NF-e recebidas há menos de 12 horas",
    tier: 99,
    effectiveOnboarding: false,
    resetOnboardingMetrics: false,
    clearSefazRetry: false,
  };
}

/** Onboarding pendente na fase de listagem que ainda nunca concluiu um sync na Focus. */
function isOnboardingPrimeiraListagemSync(row: CoRow): boolean {
  return (
    isOnboardingFiscalListSyncPhase(row.onboarding_fiscal) &&
    nfesRecebidasUltimaSyncAtMs(row) === 0
  );
}

/** Rodízio: sem `nfes_recebidas_ultima_sync_at` = prioridade máxima; com data = mais antiga primeiro. */
function syncCursorTier(row: CoRow): number {
  return nfesRecebidasUltimaSyncAtMs(row) === 0 ? 0 : 2;
}

function isSefazRetryDue(retryAtRaw: unknown): boolean {
  if (retryAtRaw == null || String(retryAtRaw).trim() === "") return true;
  const t = Date.parse(String(retryAtRaw));
  if (!Number.isFinite(t)) return true;
  return t <= Date.now();
}

type ScheduledCompany = {
  row: CoRow;
  tier: number;
  last_sync_ms: number;
  effective_onboarding: boolean;
  reset_onboarding_metrics: boolean;
  clear_sefaz_retry: boolean;
};

function classifyCompanyForSync(
  row: CoRow,
  bodyOnboarding: boolean,
  bodyOnboardingRetry: boolean,
  bypassSyncInterval = false,
): ClassifyCompanyResult {
  const obRaw = row.onboarding_fiscal;
  const pending = isOnboardingFiscalPending(obRaw);
  const listPhase = isOnboardingFiscalListSyncPhase(obRaw);
  const syncIntervalGate = shouldGateNfesRecebidasSyncInterval(
    bodyOnboarding,
    bodyOnboardingRetry,
    pending,
    bypassSyncInterval,
  );
  const finish = (result: ClassifyCompanyResult): ClassifyCompanyResult =>
    applyNfesRecebidasSyncIntervalGate(row, syncIntervalGate, result);

  const o =
    obRaw && typeof obRaw === "object" && !Array.isArray(obRaw)
      ? (obRaw as Record<string, unknown>)
      : {};
  const sefazUnavailable = o["sefaz_unavailable"] === true;
  const sefazRetryDue =
    sefazUnavailable && isSefazRetryDue(o["sefaz_retry_at"]);

  if (bodyOnboardingRetry) {
    if (!pending) {
      return {
        include: false,
        skip: "onboarding_fiscal já concluído",
        tier: 99,
        effectiveOnboarding: false,
        resetOnboardingMetrics: false,
        clearSefazRetry: false,
      };
    }
    return {
      include: true,
      tier: 0,
      effectiveOnboarding: true,
      resetOnboardingMetrics: false,
      clearSefazRetry: true,
    };
  }

  if (bodyOnboarding) {
    if (!pending) {
      return {
        include: false,
        skip: "onboarding_fiscal já concluído",
        tier: 99,
        effectiveOnboarding: false,
        resetOnboardingMetrics: false,
        clearSefazRetry: false,
      };
    }
    if (!listPhase) {
      return {
        include: false,
        skip: "onboarding_fiscal fora da fase de sincronização (aguardando interpretação)",
        tier: 99,
        effectiveOnboarding: false,
        resetOnboardingMetrics: false,
        clearSefazRetry: false,
      };
    }
    return {
      include: true,
      tier: 0,
      effectiveOnboarding: true,
      resetOnboardingMetrics: true,
      clearSefazRetry: false,
    };
  }

  if (pending && listPhase) {
    return {
      include: true,
      tier: syncCursorTier(row),
      effectiveOnboarding: true,
      resetOnboardingMetrics: false,
      clearSefazRetry: false,
    };
  }
  if (pending && sefazRetryDue) {
    return {
      include: true,
      tier: 1,
      effectiveOnboarding: true,
      resetOnboardingMetrics: false,
      clearSefazRetry: true,
    };
  }
  if (pending) {
    return {
      include: false,
      skip: "onboarding_fiscal fora da fase de sincronização (aguardando interpretação)",
      tier: 99,
      effectiveOnboarding: false,
      resetOnboardingMetrics: false,
      clearSefazRetry: false,
    };
  }

  return finish({
    include: true,
    tier: syncCursorTier(row),
    effectiveOnboarding: false,
    resetOnboardingMetrics: false,
    clearSefazRetry: false,
  });
}

function scheduleCompaniesForRun(
  rows: CoRow[],
  maxCompanies: number,
  bodyOnboarding: boolean,
  bodyOnboardingRetry: boolean,
  skipRotation: boolean,
  bypassSyncInterval = false,
): { scheduled: ScheduledCompany[]; waitlisted: CoRow[] } {
  const candidates: ScheduledCompany[] = [];
  const waitlisted: CoRow[] = [];

  for (const row of rows) {
    const companyId = String(row.id);
    const focusnfe = (row.focusnfe ?? {}) as Record<string, unknown>;
    const cnpjDigits = String(row.document ?? "")
      .replace(/\D/g, "")
      .slice(0, 14);
    if (!focusIdEmpresa(focusnfe) || cnpjDigits.length !== 14) continue;

    const cls = classifyCompanyForSync(
      row,
      bodyOnboarding,
      bodyOnboardingRetry,
      bypassSyncInterval,
    );
    if (!cls.include) {
      waitlisted.push(row);
      continue;
    }

    candidates.push({
      row,
      tier: cls.tier,
      last_sync_ms: nfesRecebidasUltimaSyncAtMs(row),
      effective_onboarding: cls.effectiveOnboarding,
      reset_onboarding_metrics: cls.resetOnboardingMetrics,
      clear_sefaz_retry: cls.clearSefazRetry,
    });
  }

  candidates.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.last_sync_ms - b.last_sync_ms;
  });

  const limit = skipRotation ? candidates.length : maxCompanies;
  return {
    scheduled: candidates.slice(0, limit),
    waitlisted: skipRotation
      ? waitlisted
      : [...waitlisted, ...candidates.slice(limit).map((c) => c.row)],
  };
}

async function touchNfesRecebidasUltimaSyncAt(
  admin: ReturnType<typeof createClient>,
  companyId: string,
): Promise<{ error?: string; sync_at?: string }> {
  const syncAt = new Date().toISOString();
  const { data: row, error: readErr } = await admin
    .from("companies")
    .select("focusnfe")
    .eq("id", companyId)
    .maybeSingle();
  if (readErr) return { error: readErr.message };

  const current =
    row?.focusnfe &&
    typeof row.focusnfe === "object" &&
    !Array.isArray(row.focusnfe)
      ? (row.focusnfe as Record<string, unknown>)
      : {};

  const { error } = await admin
    .from("companies")
    .update({
      focusnfe: { ...current, nfes_recebidas_ultima_sync_at: syncAt },
      updated_at: syncAt,
    })
    .eq("id", companyId);
  if (error) return { error: error.message };
  return { sync_at: syncAt };
}

async function persistFocusNfeSyncCursor(
  admin: ReturnType<typeof createClient>,
  companyId: string,
  versaoFinal: number,
): Promise<{ error?: string }> {
  const syncAt = new Date().toISOString();
  const { data: row, error: readErr } = await admin
    .from("companies")
    .select("focusnfe")
    .eq("id", companyId)
    .maybeSingle();
  if (readErr) return { error: readErr.message };

  const current =
    row?.focusnfe &&
    typeof row.focusnfe === "object" &&
    !Array.isArray(row.focusnfe)
      ? (row.focusnfe as Record<string, unknown>)
      : {};

  const next = {
    ...current,
    nfes_recebidas_ultima_versao: Math.max(0, Math.floor(versaoFinal)),
    nfes_recebidas_ultima_sync_at: syncAt,
  };
  const { error } = await admin
    .from("companies")
    .update({
      focusnfe: next,
      updated_at: syncAt,
    })
    .eq("id", companyId);
  if (error) return { error: error.message };
  return {};
}

type NfeCabLike = Record<string, unknown>;

type OnboardingFiscalState = {
  sync: boolean;
  max_nfes_sync: number;
  nfes_sync: number;
  nfes_ignored: number;
  completed: boolean;
  sefaz_unavailable?: boolean;
};

const SEFAZ_RETRY_MINUTES_DEFAULT = 30;

function normalizeOnboardingFiscal(raw: unknown): OnboardingFiscalState {
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const num = (k: string) => {
    const v = o[k];
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  };
  return {
    sync: o["sync"] === false ? false : true,
    max_nfes_sync: num("max_nfes_sync"),
    nfes_sync: num("nfes_sync"),
    nfes_ignored: num("nfes_ignored"),
    completed: o["completed"] === true,
  };
}

function defaultOnboardingFiscalState(): OnboardingFiscalState {
  return {
    sync: true,
    max_nfes_sync: 0,
    nfes_sync: 0,
    nfes_ignored: 0,
    completed: false,
    sefaz_unavailable: false,
  };
}

function sefazRetryMinutes(): number {
  const raw = Deno.env.get("FOCUS_ONBOARDING_SEFAZ_RETRY_MINUTES")?.trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 5 && n <= 24 * 60) return Math.floor(n);
  return SEFAZ_RETRY_MINUTES_DEFAULT;
}

/** Erros transitórios na listagem Focus/SEFAZ (não confundir com 401/403 de configuração). */
function isSefazUnavailableListError(
  status: number | null,
  isNetwork: boolean,
): boolean {
  if (isNetwork) return true;
  if (status == null) return true;
  if (status >= 500) return true;
  if (status === 429 || status === 408) return true;
  return false;
}

function clearSefazErrorFields(
  state: Record<string, unknown>,
): Record<string, unknown> {
  const o = { ...state, sefaz_unavailable: false };
  delete o.sefaz_unavailable_at;
  delete o.sefaz_retry_at;
  delete o.sefaz_error_detail;
  return o;
}

async function applyOnboardingFiscalSefazUnavailable(
  admin: ReturnType<typeof createClient>,
  companyId: string,
  detail?: string,
): Promise<{ error?: string }> {
  const retryAt = new Date(
    Date.now() + sefazRetryMinutes() * 60_000,
  ).toISOString();
  const { data: row, error: rErr } = await admin
    .from("companies")
    .select("onboarding_fiscal")
    .eq("id", companyId)
    .maybeSingle();
  if (rErr) return { error: rErr.message };
  const base =
    row?.onboarding_fiscal &&
    typeof row.onboarding_fiscal === "object" &&
    !Array.isArray(row.onboarding_fiscal)
      ? { ...(row.onboarding_fiscal as Record<string, unknown>) }
      : {};
  const prev = normalizeOnboardingFiscal(row?.onboarding_fiscal);
  const next: Record<string, unknown> = {
    ...base,
    ...prev,
    sync: true,
    sefaz_unavailable: true,
    sefaz_unavailable_at: new Date().toISOString(),
    sefaz_retry_at: retryAt,
  };
  if (detail) next.sefaz_error_detail = detail.slice(0, 300);
  const { error: uErr } = await admin
    .from("companies")
    .update({
      onboarding_fiscal: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", companyId);
  if (uErr) return { error: uErr.message };
  console.log(
    LOG,
    "onboarding_fiscal_sefaz_unavailable",
    JSON.stringify({ company_id: companyId, sefaz_retry_at: retryAt }),
  );
  return {};
}

async function clearOnboardingFiscalSefazForRetry(
  admin: ReturnType<typeof createClient>,
  companyId: string,
): Promise<{ error?: string }> {
  const { data: row, error: rErr } = await admin
    .from("companies")
    .select("onboarding_fiscal")
    .eq("id", companyId)
    .maybeSingle();
  if (rErr) return { error: rErr.message };
  const base =
    row?.onboarding_fiscal &&
    typeof row.onboarding_fiscal === "object" &&
    !Array.isArray(row.onboarding_fiscal)
      ? { ...(row.onboarding_fiscal as Record<string, unknown>) }
      : {};
  const prev = normalizeOnboardingFiscal(row?.onboarding_fiscal);
  const next = clearSefazErrorFields({ ...base, ...prev });
  const { error: uErr } = await admin
    .from("companies")
    .update({
      onboarding_fiscal: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", companyId);
  if (uErr) return { error: uErr.message };
  return {};
}

async function applyOnboardingFiscalDefaults(
  admin: ReturnType<typeof createClient>,
  companyId: string,
): Promise<{ error?: string }> {
  const next = defaultOnboardingFiscalState();
  const { error: uErr } = await admin
    .from("companies")
    .update({
      onboarding_fiscal: next as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq("id", companyId);
  if (uErr) return { error: uErr.message };
  return {};
}

/**
 * Após listagem Focus no onboarding: grava `max_nfes_sync`.
 * `sync: false` só se não há XML em staging (`endListagemSync`); senão mantém `sync: true` até o job `done`.
 */
async function patchOnboardingFiscalAfterListagem(
  admin: ReturnType<typeof createClient>,
  companyId: string,
  maxNfesSync: number,
  opts: { endListagemSync: boolean },
): Promise<{ error?: string }> {
  const { data: row, error: rErr } = await admin
    .from("companies")
    .select("onboarding_fiscal")
    .eq("id", companyId)
    .maybeSingle();
  if (rErr) return { error: rErr.message };
  if (!isOnboardingFiscalPending(row?.onboarding_fiscal)) return {};
  const base =
    row?.onboarding_fiscal &&
    typeof row.onboarding_fiscal === "object" &&
    !Array.isArray(row.onboarding_fiscal)
      ? { ...(row.onboarding_fiscal as Record<string, unknown>) }
      : {};
  const prev = normalizeOnboardingFiscal(row?.onboarding_fiscal);
  const next = clearSefazErrorFields({
    ...base,
    ...prev,
    max_nfes_sync: maxNfesSync,
    nfes_sync: opts.endListagemSync ? prev.nfes_sync : 0,
    sync: opts.endListagemSync ? false : true,
  });
  const { error: uErr } = await admin
    .from("companies")
    .update({
      onboarding_fiscal: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", companyId);
  if (uErr) return { error: uErr.message };
  return {};
}

type ActiveInterpretJob = {
  id: string;
  exec_id: string;
  status: string;
  onboarding: boolean | null;
};

async function countStagingXmlsForInterpretJob(
  admin: ReturnType<typeof createClient>,
  execId: string,
  companyId: string,
): Promise<{ count: number; error?: string }> {
  const { count, error } = await admin
    .from("focus_get_sync_nfe_staging")
    .select("id", { count: "exact", head: true })
    .eq("exec_id", execId)
    .eq("company_id", companyId)
    .not("xml_content", "is", null)
    .neq("xml_content", "");
  if (error) return { count: 0, error: error.message };
  return { count: count ?? 0 };
}

async function findActiveInterpretJob(
  admin: ReturnType<typeof createClient>,
  companyId: string,
): Promise<ActiveInterpretJob | null> {
  const { data, error } = await admin
    .from("focus_get_sync_nfe_interpret_jobs")
    .select("id, exec_id, status, onboarding")
    .eq("company_id", companyId)
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(LOG, "interpret_job_active_select", companyId, error.message);
    return null;
  }
  if (!data?.id) return null;
  return data as ActiveInterpretJob;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405);

  try {
    const tWall0 = performance.now();

    // --- Passo 1: body, segredo cron / manual + JWT, env Supabase + Focus ---
    const bodyRaw = await req.json().catch(() => ({}));
    const body =
      bodyRaw && typeof bodyRaw === "object" && !Array.isArray(bodyRaw)
        ? (bodyRaw as Record<string, unknown>)
        : {};

    const onboardingFlow = body.onboarding === true;
    const onboardingRetry = body.onboarding_retry === true;

    const expected = Deno.env.get("FOCUS_NFE_RECEBIDAS_CRON_SECRET")?.trim();
    if (!expected) {
      return json(
        {
          ok: false,
          error:
            "Defina FOCUS_NFE_RECEBIDAS_CRON_SECRET (secret no Authorization Bearer para chamadas agendadas ou internas).",
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
      Deno.env.get("FOCUS_NFE_API_BASE")?.trim() ||
      "https://api.focusnfe.com.br"
    ).replace(/\/$/, "");

    if (!supabaseUrl || !anonKey || !serviceKey || !focusToken) {
      return json(
        { ok: false, error: "Variáveis Supabase ou FOCUS_NFE_TOKEN em falta." },
        500,
      );
    }

    const maxCompanies = intFromEnv(
      "FOCUS_GET_SYNC_MAX_COMPANIES_PER_RUN",
      1,
      1,
      500,
    );
    const maxPages = intFromEnv("FOCUS_GET_SYNC_MAX_PAGES", 80, 1, 500);

    const cronFilterCompanyId = isCron
      ? String(body.company_id ?? "").trim()
      : "";

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let companiesToProcess: CoRow[] = [];
    let isManualSingle = false;
    let bodyVersaoInicial: number | null = null;

    if (isCron) {
      const interpretJobBloqueando = await findActiveInterpretJob(
        admin,
        companyId,
      );

      if (interpretJobBloqueando?.id) {
        logPhase("interpret_job_pending_ou_processing", {
          exec_id: execId,
          company_id: companyId,
          motivo:
            "interpret job ativo (pending/processing); sync automática adiada",
        });
        detail.push({
          company_id: companyId,
          skipped:
            "interpret job ativo (pending/processing); sync automática adiada",
          interpret_job_id: interpretJobBloqueando.id,
          interpret_job_status: interpretJobBloqueando.status,
        });
        return json(
          {
            ok: false,
            error:
              "Interpret job ativo (pending/processing); sync automática adiada",
          },
          400,
        );
      }

      const { data: companies, error: listErr } = await admin
        .from("companies")
        .select("id, document, focusnfe, onboarding_fiscal");

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
        return json(
          {
            ok: false,
            error: "manual: true requer company_id (UUID da unidade).",
          },
          400,
        );
      }
      if (!authHeader.startsWith("Bearer ") || !bearer) {
        return json(
          { ok: false, error: "Envie Authorization: Bearer <JWT da sessão>." },
          401,
        );
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
        return json(
          { ok: false, error: "Sessão inválida. Entre novamente." },
          401,
        );
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
        .select("id, document, focusnfe, onboarding_fiscal")
        .eq("id", companyIdManual)
        .maybeSingle();
      if (coErr || !oneRow) {
        return json({ ok: false, error: "Unidade não encontrada." }, 404);
      }
      companiesToProcess = [oneRow as CoRow];
      isManualSingle = true;
      const rawv = body.versao;
      if (rawv !== undefined && rawv !== null && String(rawv).trim() !== "") {
        const n = Number(rawv);
        if (Number.isFinite(n) && n >= 0) bodyVersaoInicial = Math.floor(n);
      }
    }

    const execId = crypto.randomUUID();

    logPhase("exec_inicio", {
      exec_id: execId,
      modo: isCron ? "cron" : "manual",
      onboarding: onboardingFlow,
      onboarding_retry: onboardingRetry,
      company_id_filtro: cronFilterCompanyId || null,
      empresas_candidatas: companiesToProcess.length,
      max_empresas_por_run: maxCompanies,
      max_paginas_por_empresa: maxPages,
      versao_manual: bodyVersaoInicial,
    });

    const detail: Array<Record<string, unknown>> = [];
    const skipRotation =
      isManualSingle ||
      Boolean(cronFilterCompanyId) ||
      companiesToProcess.length <= 1;

    for (const row of companiesToProcess) {
      const companyId = String(row.id);
      const focusnfe = (row.focusnfe ?? {}) as Record<string, unknown>;
      const cnpjDigits = String(row.document ?? "")
        .replace(/\D/g, "")
        .slice(0, 14);
      if (!focusIdEmpresa(focusnfe)) {
        logPhase("elegibilidade_skip", {
          exec_id: execId,
          company_id: companyId,
          motivo: "sem id_empresa Focus",
        });
        detail.push({ company_id: companyId, skipped: "sem id_empresa Focus" });
        continue;
      }
      if (cnpjDigits.length !== 14) {
        logPhase("elegibilidade_skip", {
          exec_id: execId,
          company_id: companyId,
          motivo: "document sem CNPJ 14 dígitos",
          cnpj_len: cnpjDigits.length,
        });
        detail.push({
          company_id: companyId,
          skipped: "document sem CNPJ 14 dígitos",
        });
        continue;
      }

      const cls = classifyCompanyForSync(
        row,
        onboardingFlow,
        onboardingRetry,
        isManualSingle,
      );
      if (!cls.include) {
        logPhase("onboarding_fiscal_skip", {
          exec_id: execId,
          company_id: companyId,
          motivo: cls.skip,
          onboarding_fiscal: summarizeOnboardingFiscal(row.onboarding_fiscal),
        });
        detail.push({ company_id: companyId, skipped: cls.skip });
      }
    }

    const { scheduled, waitlisted } = scheduleCompaniesForRun(
      companiesToProcess,
      maxCompanies,
      onboardingFlow,
      onboardingRetry,
      skipRotation,
      isManualSingle,
    );

    for (const row of waitlisted) {
      const focusnfe = (row.focusnfe ?? {}) as Record<string, unknown>;
      const cnpjDigits = String(row.document ?? "")
        .replace(/\D/g, "")
        .slice(0, 14);
      if (!focusIdEmpresa(focusnfe) || cnpjDigits.length !== 14) continue;
      const cls = classifyCompanyForSync(
        row,
        onboardingFlow,
        onboardingRetry,
        isManualSingle,
      );
      if (cls.include) {
        logPhase("rodizio_aguardando", {
          exec_id: execId,
          company_id: row.id,
          tier: cls.tier,
          ultima_sync_ms: nfesRecebidasUltimaSyncAtMs(row),
          onboarding_primeira_sync: isOnboardingPrimeiraListagemSync(row),
        });
        detail.push({
          company_id: row.id,
          skipped:
            "aguardando rodízio (outra unidade com prioridade neste run)",
        });
      }
    }

    logPhase("rodizio_selecao", {
      exec_id: execId,
      candidatas: companiesToProcess.length,
      agendadas: scheduled.length,
      aguardando_rodizio: waitlisted.filter((row) => {
        const cls = classifyCompanyForSync(
          row,
          onboardingFlow,
          onboardingRetry,
          isManualSingle,
        );
        return cls.include;
      }).length,
      skip_rotation: skipRotation,
      fila: scheduled.map((s, i) => ({
        posicao: i + 1,
        company_id: s.row.id,
        tier: s.tier,
        ultima_sync_ms: s.last_sync_ms,
        onboarding: s.effective_onboarding,
        onboarding_primeira_sync: isOnboardingPrimeiraListagemSync(s.row),
      })),
    });

    // --- Passo 2: para cada unidade, GET na Focus (headers + versão) e staging só nfe_completa true ---
    for (const item of scheduled) {
      const row = item.row;
      const companyId = String(row.id);
      const focusnfe = (row.focusnfe ?? {}) as Record<string, unknown>;
      const cnpjDigits = String(row.document ?? "")
        .replace(/\D/g, "")
        .slice(0, 14);
      const obRaw = row.onboarding_fiscal;

      const reserveSyncAt = await touchNfesRecebidasUltimaSyncAt(
        admin,
        companyId,
      );
      if (reserveSyncAt.error) {
        console.warn(
          LOG,
          "nfes_recebidas_ultima_sync_at_reserva",
          companyId,
          reserveSyncAt.error,
        );
        detail.push({
          company_id: companyId,
          skipped: "falha ao reservar nfes_recebidas_ultima_sync_at",
        });
        continue;
      }
      logPhase("rodizio_reserva_sync_at", {
        exec_id: execId,
        company_id: companyId,
        nfes_recebidas_ultima_sync_at: reserveSyncAt.sync_at,
      });

      const { data: coFreshRow, error: coFreshErr } = await admin
        .from("companies")
        .select("onboarding_fiscal, focusnfe")
        .eq("id", companyId)
        .maybeSingle();
      if (coFreshErr) {
        console.warn(LOG, "company_fresh_read", companyId, coFreshErr.message);
      }
      const obFresh = coFreshRow?.onboarding_fiscal ?? obRaw;

      if (
        isOnboardingFiscalPending(obFresh) &&
        !isOnboardingFiscalListSyncPhase(obFresh) &&
        !onboardingFlow &&
        !onboardingRetry
      ) {
        logPhase("empresa_ignorada", {
          exec_id: execId,
          company_id: companyId,
          motivo: "onboarding_aguardando_interpretacao",
          onboarding_fiscal: summarizeOnboardingFiscal(obFresh),
        });
        detail.push({
          company_id: companyId,
          skipped: "onboarding aguardando interpretação de NF-e",
        });
        continue;
      }

      const companyOnboardingFlow =
        item.effective_onboarding &&
        isOnboardingFiscalPending(obFresh) &&
        isOnboardingFiscalListSyncPhase(obFresh);

      const activeInterpretJob = await findActiveInterpretJob(admin, companyId);
      const stagingExecId = activeInterpretJob?.exec_id ?? execId;

      const storedRaw = Number(
        (coFreshRow?.focusnfe as Record<string, unknown> | undefined)
          ?.nfes_recebidas_ultima_versao ??
          focusnfe.nfes_recebidas_ultima_versao,
      );
      const versaoCursorArmazenada =
        Number.isFinite(storedRaw) && storedRaw >= 0
          ? Math.floor(storedRaw)
          : 0;
      let versao =
        isManualSingle && bodyVersaoInicial !== null
          ? bodyVersaoInicial
          : versaoCursorArmazenada;

      let quantasBuscas = 0;
      let notasEncontradas = 0;
      const focusHttpMs: number[] = [];
      const tCompany0 = performance.now();
      const xmlGapMs = throttleMsBetweenXmlDownloads();
      let companySyncOk = true;
      /** Pelo menos uma página da lista Focus respondeu HTTP OK (parse OK). */
      let hadSuccessfulListFetch = false;
      /** Listagem encerrou por regra Focus (sem mais páginas neste ciclo). */
      let listagemConcluida = false;
      let versaoFinal = versao;

      logPhase("empresa_inicio", {
        exec_id: execId,
        staging_exec_id: stagingExecId,
        company_id: companyId,
        cnpj: cnpjDigits,
        id_empresa_focus: focusIdEmpresa(focusnfe),
        versao_inicial: versao,
        versao_persistida: versaoCursorArmazenada,
        versao_override_manual:
          isManualSingle && bodyVersaoInicial !== null
            ? bodyVersaoInicial
            : null,
        onboarding_fiscal: summarizeOnboardingFiscal(obFresh),
        onboarding_flow: companyOnboardingFlow,
        interpret_job_ativo: activeInterpretJob
          ? {
              id: activeInterpretJob.id,
              exec_id: activeInterpretJob.exec_id,
              status: activeInterpretJob.status,
            }
          : null,
        onboarding_retry: item.clear_sefaz_retry,
        rodizio_tier: item.tier,
        ultima_sync_ms: item.last_sync_ms,
      });

      if (item.reset_onboarding_metrics) {
        const { error: obResetErr } = await applyOnboardingFiscalDefaults(
          admin,
          companyId,
        );
        if (obResetErr) {
          console.warn(LOG, "onboarding_fiscal_reset", companyId, obResetErr);
          detail.push({
            company_id: companyId,
            ok: false,
            error: `onboarding_fiscal reset: ${obResetErr}`,
          });
          continue;
        }
        logPhase("onboarding_processamento", {
          exec_id: execId,
          company_id: companyId,
        });
      } else if (item.clear_sefaz_retry) {
        const { error: clrErr } = await clearOnboardingFiscalSefazForRetry(
          admin,
          companyId,
        );
        if (clrErr) {
          console.warn(LOG, "onboarding_fiscal_retry_clear", companyId, clrErr);
        }
        logPhase("onboarding_retry", {
          exec_id: execId,
          company_id: companyId,
          onboarding_fiscal: summarizeOnboardingFiscal(obRaw),
        });
      }

      for (let page = 0; page < maxPages; page++) {
        const listUrl = `${apiBase}/v2/nfes_recebidas?cnpj=${encodeURIComponent(cnpjDigits)}&versao=${versao}`;

        const tHttp0 = performance.now();
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
          logPhase("focus_lista_erro", {
            exec_id: execId,
            company_id: companyId,
            pagina: page + 1,
            versao_query: versao,
            erro: e instanceof Error ? e.message : String(e),
          });
          companySyncOk = false;
          const errMsg = "falha de rede na lista Focus";
          if (companyOnboardingFlow) {
            await applyOnboardingFiscalSefazUnavailable(
              admin,
              companyId,
              errMsg,
            );
          }
          detail.push({
            company_id: companyId,
            cnpj: cnpjDigits,
            ok: false,
            error: errMsg,
            sefaz_unavailable: companyOnboardingFlow,
            quantasBuscasForamExecutadas: quantasBuscas,
            notasEncontradas: 0,
          });
          break;
        }
        focusHttpMs.push(Math.round(performance.now() - tHttp0));
        quantasBuscas += 1;

        const xTotalCount = intHeader(listRes, "x-total-count");
        const xMaxVersion = intHeader(listRes, "x-max-version");

        const listText = await listRes.text();
        if (!listRes.ok) {
          const errMsg = `Focus lista HTTP ${listRes.status}: ${listText.slice(0, 200)}`;
          logPhase("focus_lista_erro", {
            exec_id: execId,
            company_id: companyId,
            pagina: page + 1,
            versao_query: versao,
            http_status: listRes.status,
            erro: errMsg.slice(0, 300),
          });
          companySyncOk = false;
          if (
            companyOnboardingFlow &&
            isSefazUnavailableListError(listRes.status, false)
          ) {
            await applyOnboardingFiscalSefazUnavailable(
              admin,
              companyId,
              errMsg,
            );
          }
          detail.push({
            company_id: companyId,
            cnpj: cnpjDigits,
            ok: false,
            error: errMsg,
            sefaz_unavailable:
              companyOnboardingFlow &&
              isSefazUnavailableListError(listRes.status, false),
            quantasBuscasForamExecutadas: quantasBuscas,
            notasEncontradas: notasEncontradas,
          });
          break;
        }

        let lista: unknown;
        try {
          lista = listText ? JSON.parse(listText) : [];
        } catch {
          const errMsg = `Resposta lista inválida (HTTP ${listRes.status})`;
          companySyncOk = false;
          if (companyOnboardingFlow) {
            await applyOnboardingFiscalSefazUnavailable(
              admin,
              companyId,
              errMsg,
            );
          }
          detail.push({
            company_id: companyId,
            cnpj: cnpjDigits,
            ok: false,
            error: errMsg,
            sefaz_unavailable: companyOnboardingFlow,
            quantasBuscasForamExecutadas: quantasBuscas,
            notasEncontradas: notasEncontradas,
          });
          break;
        }

        hadSuccessfulListFetch = true;

        if (!Array.isArray(lista)) {
          const errMsg = `Formato de lista inesperado (HTTP ${listRes.status})`;
          companySyncOk = false;
          if (companyOnboardingFlow) {
            await applyOnboardingFiscalSefazUnavailable(
              admin,
              companyId,
              errMsg,
            );
          }
          detail.push({
            company_id: companyId,
            cnpj: cnpjDigits,
            ok: false,
            error: errMsg,
            sefaz_unavailable: companyOnboardingFlow,
            quantasBuscasForamExecutadas: quantasBuscas,
            notasEncontradas: notasEncontradas,
          });
          break;
        }

        const cabList = lista as NfeCabLike[];

        const completas = cabList.filter(
          (cab) =>
            isNfeCompletaExplicitTrue(cab["nfe_completa"]) &&
            cab["situacao"] === "autorizada",
        );

        const completasComChave = completas
          .map((cab) => ({
            cab,
            chave: String(cab["chave_nfe"] ?? "").replace(/\D/g, ""),
          }))
          .filter((x) => x.chave.length === 44);

        logPhase("focus_lista_pagina", {
          exec_id: execId,
          company_id: companyId,
          pagina: page + 1,
          versao_query: versao,
          http_status: listRes.status,
          http_ms: focusHttpMs[focusHttpMs.length - 1],
          x_total_count: xTotalCount,
          x_max_version: xMaxVersion,
          itens_lista: cabList.length,
          nfe_completa_autorizada: completas.length,
          com_chave_44: completasComChave.length,
          notas_staging_acumuladas: notasEncontradas,
        });

        for (
          let chunkStart = 0;
          chunkStart < completasComChave.length;
          chunkStart += XML_DOWNLOAD_PARALLEL
        ) {
          if (chunkStart > 0 && xmlGapMs > 0) await sleep(xmlGapMs);
          const chunk = completasComChave.slice(
            chunkStart,
            chunkStart + XML_DOWNLOAD_PARALLEL,
          );

          const chunkWithXml = await Promise.all(
            chunk.map(async ({ cab, chave }) => {
              const xmlUrl = `${apiBase}/v2/nfes_recebidas/${encodeURIComponent(chave)}.xml?cnpj=${encodeURIComponent(cnpjDigits)}`;
              const got = await fetchNfeRecebidaXmlWithRetry(
                xmlUrl,
                focusToken,
                chave,
              );
              let xmlContent: string | null = null;
              if (got.ok) {
                const raw = new TextDecoder("utf-8", { fatal: false }).decode(
                  got.buf,
                );
                const head = raw
                  .slice(0, Math.min(200, raw.length))
                  .toLowerCase();
                if (head.includes("nfe") || head.includes("nfeproc")) {
                  xmlContent = raw;
                } else {
                  console.warn(
                    LOG,
                    JSON.stringify({
                      fase: "xml_corpo_suspeito",
                      chave_nfe_44: chave,
                      company_id: companyId,
                    }),
                  );
                }
              }
              return { cab, chave, xmlContent };
            }),
          );

          const chunkChaves = chunkWithXml.map((x) => x.chave);
          const existingStagingByChave = new Map<string, string>();
          if (chunkChaves.length > 0) {
            const { data: existingRows, error: stagingBatchErr } = await admin
              .from("focus_get_sync_nfe_staging")
              .select("id,chave_nfe")
              .eq("company_id", companyId)
              .in("chave_nfe", chunkChaves);
            if (stagingBatchErr) {
              console.warn(
                LOG,
                "staging_select_batch",
                companyId,
                stagingBatchErr.message,
              );
            } else {
              for (const r of existingRows ?? []) {
                const k = String(r.chave_nfe ?? "").replace(/\D/g, "");
                const id = r.id != null ? String(r.id) : "";
                if (k.length === 44 && id) existingStagingByChave.set(k, id);
              }
            }
          }

          for (const { cab, chave, xmlContent } of chunkWithXml) {
            const stagingExistingId = existingStagingByChave.get(chave) ?? null;

            const vnf = cab["versao"];
            const versaoNf =
              vnf !== undefined && vnf !== null && Number.isFinite(Number(vnf))
                ? Math.floor(Number(vnf))
                : null;
            const situacao =
              cab["situacao"] !== undefined && cab["situacao"] !== null
                ? String(cab["situacao"])
                : null;

            const stagingRow = {
              exec_id: stagingExecId,
              cnpj: cnpjDigits,
              versao_nf: versaoNf,
              situacao,
              nfe_completa: true,
              payload: cab,
              expires_at: new Date(
                Date.now() + 7 * 24 * 60 * 60 * 1000,
              ).toISOString(),
              ...(xmlContent != null ? { xml_content: xmlContent } : {}),
            };

            if (stagingExistingId) {
              const { error: updErr } = await admin
                .from("focus_get_sync_nfe_staging")
                .update(stagingRow)
                .eq("id", stagingExistingId);
              if (updErr) {
                console.warn(
                  LOG,
                  "staging_update",
                  companyId,
                  chave,
                  updErr.message,
                );
              } else {
                notasEncontradas += 1;
              }
            } else {
              const { error: insErr } = await admin
                .from("focus_get_sync_nfe_staging")
                .insert({
                  ...stagingRow,
                  company_id: companyId,
                  chave_nfe: chave,
                  xml_content: xmlContent,
                });
              if (insErr) {
                console.warn(LOG, "staging_insert", companyId, insErr.message);
              } else {
                notasEncontradas += 1;
              }
            }
          }
        }

        // x-total-count == 0 → não há mais notas a consultar (regra Focus / pedido de produto).
        if (xTotalCount === 0) {
          listagemConcluida = true;
          logPhase("paginacao_fim", {
            exec_id: execId,
            company_id: companyId,
            motivo: "x_total_count_zero",
            pagina: page + 1,
            versao_final: versao,
          });
          break;
        }

        if (cabList.length === 0) {
          if (
            xMaxVersion != null &&
            Number.isFinite(xMaxVersion) &&
            xMaxVersion > versao
          ) {
            logPhase("paginacao_avanco", {
              exec_id: execId,
              company_id: companyId,
              motivo: "lista_vazia_avanca_versao",
              versao_anterior: versao,
              versao_nova: xMaxVersion,
            });
            versao = xMaxVersion;
            versaoFinal = versao;
            continue;
          }
          listagemConcluida = true;
          logPhase("paginacao_fim", {
            exec_id: execId,
            company_id: companyId,
            motivo: "lista_vazia_sem_avanco",
            pagina: page + 1,
            versao_final: versao,
          });
          break;
        }

        if (xMaxVersion === null || !Number.isFinite(xMaxVersion)) {
          logPhase("paginacao_fim", {
            exec_id: execId,
            company_id: companyId,
            motivo: "x_max_version_invalido",
            pagina: page + 1,
            x_max_version: xMaxVersion,
          });
          break;
        }
        if (xMaxVersion === versao) {
          listagemConcluida = true;
          logPhase("paginacao_fim", {
            exec_id: execId,
            company_id: companyId,
            motivo: "versao_estavel",
            pagina: page + 1,
            versao_final: versao,
          });
          break;
        }
        logPhase("paginacao_avanco", {
          exec_id: execId,
          company_id: companyId,
          motivo: "x_max_version",
          versao_anterior: versao,
          versao_nova: xMaxVersion,
        });
        versao = xMaxVersion;
        versaoFinal = versao;
      }

      const temposDeProcessamento = {
        focus_http_ms_por_busca: focusHttpMs,
        focus_http_ms_total: focusHttpMs.reduce((a, b) => a + b, 0),
        empresa_total_ms: Math.round(performance.now() - tCompany0),
        wall_total_ms_ate_agora: Math.round(performance.now() - tWall0),
      };

      const { count: stagingXmlTotal, error: xmlCountErr } =
        await countStagingXmlsForInterpretJob(admin, stagingExecId, companyId);
      if (xmlCountErr) {
        console.warn(
          LOG,
          "interpret_staging_xml_count",
          companyId,
          xmlCountErr,
        );
      }

      if (stagingXmlTotal > 0) {
        if (activeInterpretJob?.id) {
          const jobPatch: Record<string, unknown> = {
            staging_xml_total: stagingXmlTotal,
          };
          if (activeInterpretJob.onboarding !== companyOnboardingFlow) {
            jobPatch.onboarding = companyOnboardingFlow;
          }
          const { error: updJobErr } = await admin
            .from("focus_get_sync_nfe_interpret_jobs")
            .update(jobPatch)
            .eq("id", activeInterpretJob.id);
          if (updJobErr) {
            console.warn(
              LOG,
              "interpret_job_update",
              companyId,
              updJobErr.message,
            );
          }
          logPhase("interpret_job_ja_ativo", {
            exec_id: execId,
            staging_exec_id: stagingExecId,
            company_id: companyId,
            job_id: activeInterpretJob.id,
            job_status: activeInterpretJob.status,
            notas_staging_novas: notasEncontradas,
            staging_xml_total: stagingXmlTotal,
          });
        } else {
          const { data: existingJob, error: selJobErr } = await admin
            .from("focus_get_sync_nfe_interpret_jobs")
            .select("id,status")
            .eq("exec_id", stagingExecId)
            .eq("company_id", companyId)
            .maybeSingle();
          if (selJobErr) {
            console.warn(
              LOG,
              "interpret_job_select",
              companyId,
              selJobErr.message,
            );
          } else if (!existingJob?.id) {
            const { error: insJobErr } = await admin
              .from("focus_get_sync_nfe_interpret_jobs")
              .insert({
                exec_id: stagingExecId,
                company_id: companyId,
                status: "pending",
                onboarding: companyOnboardingFlow,
                staging_process_offset: 0,
                staging_xml_total: stagingXmlTotal,
              });
            if (insJobErr) {
              console.warn(
                LOG,
                "interpret_job_insert",
                companyId,
                insJobErr.message,
              );
            } else {
              logPhase("interpret_job_enfileirado", {
                exec_id: stagingExecId,
                company_id: companyId,
                onboarding: companyOnboardingFlow,
                notas_staging: notasEncontradas,
                staging_xml_total: stagingXmlTotal,
              });
            }
          }
        }
      } else if (notasEncontradas > 0) {
        logPhase("interpret_job_omitido_sem_xml", {
          exec_id: stagingExecId,
          company_id: companyId,
          notas_staging_sem_xml: notasEncontradas,
        });
      }

      if (
        companyOnboardingFlow &&
        hadSuccessfulListFetch &&
        listagemConcluida
      ) {
        const xmlTotal = Math.max(0, stagingXmlTotal ?? 0);
        const endListagemSync = xmlTotal === 0;
        const { error: obErr } = await patchOnboardingFiscalAfterListagem(
          admin,
          companyId,
          xmlTotal,
          { endListagemSync },
        );
        if (obErr) {
          console.warn(LOG, "onboarding_fiscal_listagem_fim", companyId, obErr);
        } else {
          logPhase("onboarding_fiscal_listagem_finalizada", {
            exec_id: execId,
            company_id: companyId,
            max_nfes_sync: xmlTotal,
            sync: endListagemSync ? false : true,
            aguarda_interpret_job: !endListagemSync,
          });
        }
      }

      const shouldPersistCursor = hadSuccessfulListFetch;

      logPhase("empresa_fim", {
        exec_id: execId,
        company_id: companyId,
        cnpj: cnpjDigits,
        ok: companySyncOk,
        cursor_sera_persistido: shouldPersistCursor,
        had_successful_list_fetch: hadSuccessfulListFetch,
        notas_staging: notasEncontradas,
        buscas_focus: quantasBuscas,
        onboarding_flow: companyOnboardingFlow,
        onboarding_fiscal: summarizeOnboardingFiscal(obFresh),
        listagem_concluida: listagemConcluida,
        staging_exec_id: stagingExecId,
        versao_final: versaoFinal,
        ...temposDeProcessamento,
      });

      let cursorFoiPersistido = false;
      if (shouldPersistCursor) {
        const { error: cursorErr } = await persistFocusNfeSyncCursor(
          admin,
          companyId,
          versaoFinal,
        );
        if (cursorErr) {
          console.warn(LOG, "focusnfe_cursor_persist", companyId, cursorErr);
        } else {
          cursorFoiPersistido = true;
          logPhase("focusnfe_cursor_persistido", {
            exec_id: execId,
            company_id: companyId,
            versao_final: versaoFinal,
            parcial: !companySyncOk,
          });
        }
      } else {
        logPhase("focusnfe_cursor_nao_persistido", {
          exec_id: execId,
          company_id: companyId,
          motivo: "sem_consulta_focus_ok",
          company_sync_ok: companySyncOk,
          had_successful_list_fetch: hadSuccessfulListFetch,
          buscas_focus: quantasBuscas,
        });
      }

      if (companySyncOk) {
        detail.push({
          company_id: companyId,
          cnpj: cnpjDigits,
          ok: true,
          exec_id: execId,
          notasEncontradas,
          quantasBuscasForamExecutadas: quantasBuscas,
          versao_final: versaoFinal,
          rodizio_tier: item.tier,
          cursor_persistido: cursorFoiPersistido,
          temposDeProcessamento,
        });
      }
    }

    const wallTotalMs = Math.round(performance.now() - tWall0);
    const processadasOk = detail.filter((d) => d.ok === true).length;
    const ignoradas = detail.filter(
      (d) => typeof d.skipped === "string",
    ).length;
    const comErro = detail.filter((d) => d.ok === false).length;

    logPhase("exec_fim", {
      exec_id: execId,
      wall_total_ms: wallTotalMs,
      agendadas: scheduled.length,
      processadas_ok: processadasOk,
      ignoradas,
      com_erro: comErro,
      onboarding: onboardingFlow,
      onboarding_retry: onboardingRetry,
    });

    return json({
      ok: true,
      exec_id: execId,
      detail,
      metrics: {
        empresas_processadas: scheduled.length,
        empresas_agendadas: scheduled.length,
        empresas_ok: processadasOk,
        empresas_ignoradas: ignoradas,
        empresas_erro: comErro,
        wall_total_ms: wallTotalMs,
      },
    });
  } catch (e) {
    console.error(LOG, "unhandled_error", e);
    return json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      500,
    );
  }
});

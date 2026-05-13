import { supabase } from "@/lib/supabase";

/**
 * Só renovar JWT quando faltar pouco tempo — margem grande evita spam a
 * `auth/v1/token` (504 sob carga) durante drenagens longas.
 */
const ACCESS_TOKEN_REFRESH_MARGIN_SEC = 900;

/** Evita `refreshSession` em rajada (vários invokes + Dashboard). */
let lastAuthRefreshWallMs = 0;
const AUTH_REFRESH_MIN_INTERVAL_MS = 90_000;

/** Alinhado à edge `process-import-job-batch` (CHAIN_RETRYABLE_HTTP). */
const BATCH_RETRYABLE_HTTP = new Set([546, 503, 529, 504]);

/** Poucas tentativas com espera longa: menos linhas de erro 546 no DevTools. */
const BATCH_POST_BACKOFF_MS = [0, 3_000, 9_000, 18_000];

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => globalThis.setTimeout(r, ms));
}

async function getValidAccessTokenForFunctions(): Promise<string> {
  const { data: first, error: getErr } = await supabase.auth.getSession();
  if (getErr && import.meta.env.DEV) {
    console.warn("[processImportJobBatchClient] getSession", getErr.message);
  }
  const s = first.session;
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = typeof s?.expires_at === "number" ? s.expires_at : 0;
  const token = s?.access_token;
  if (token && exp > nowSec + ACCESS_TOKEN_REFRESH_MARGIN_SEC) {
    return token;
  }
  const nowWall = Date.now();
  if (
    token &&
    exp > nowSec + 90 &&
    nowWall - lastAuthRefreshWallMs < AUTH_REFRESH_MIN_INTERVAL_MS
  ) {
    return token;
  }
  const { data: refreshed, error: refErr } = await supabase.auth.refreshSession();
  if (refErr) {
    if (token) return token;
    throw new Error(refErr.message || "Sessão expirada. Entre novamente.");
  }
  const t2 = refreshed.session?.access_token;
  if (!t2) {
    if (token) return token;
    throw new Error("Sessão inválida.");
  }
  lastAuthRefreshWallMs = Date.now();
  return t2;
}

/**
 * Resposta típica de `process-import-job-batch`.
 * Importante: na Supabase Edge, encadeamento interno via `fetch`/`waitUntil` pode sofrer
 * `EarlyDrop` após o HTTP responder — por isso o cliente deve reinvocar até não haver pendências.
 */
export type ProcessImportJobBatchResponse = {
  ok?: boolean;
  error?: string;
  batch_id?: string;
  exec_id?: string;
  status?: string;
  processed_files?: number;
  success_files?: number;
  failed_files?: number;
  pending_review_files?: number;
  remaining_files?: number;
  cancelled?: boolean;
};

async function postBatchOnce(
  url: string,
  bodyJson: string,
  token: string,
  anonKey: string,
): Promise<{ res: Response; data: ProcessImportJobBatchResponse }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: bodyJson,
  });
  const data = (await res.json().catch(() => ({}))) as ProcessImportJobBatchResponse;
  return { res, data };
}

/**
 * POST com backoff em 546/504/503/529 — alivia limite do worker e reduz rajadas de falhas.
 */
async function postBatchWithWorkerRetry(
  url: string,
  bodyJson: string,
  token: string,
  anonKey: string,
): Promise<{ res: Response; data: ProcessImportJobBatchResponse }> {
  let last: { res: Response; data: ProcessImportJobBatchResponse } | undefined;
  for (let a = 0; a < BATCH_POST_BACKOFF_MS.length; a += 1) {
    const wait = BATCH_POST_BACKOFF_MS[a] ?? 0;
    if (wait > 0) await sleep(wait);
    last = await postBatchOnce(url, bodyJson, token, anonKey);
    const { res, data } = last;
    if (res.ok) return { res, data };
    if (res.status === 401) return { res, data };
    if (!BATCH_RETRYABLE_HTTP.has(res.status)) return { res, data };
  }
  return last!;
}

export async function invokeProcessImportJobBatch(
  batchId: string,
  invokeOptions?: { test_single_file?: boolean },
): Promise<{ res: Response; data: ProcessImportJobBatchResponse }> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const url = `${baseUrl.replace(/\/$/, "")}/functions/v1/process-import-job-batch`;
  const bodyJson = JSON.stringify({
    batch_id: batchId,
    ...(invokeOptions?.test_single_file === true ? { test_single_file: true } : {}),
  });

  let token = await getValidAccessTokenForFunctions();
  let out = await postBatchWithWorkerRetry(url, bodyJson, token, anon);
  if (out.res.status === 401) {
    const { data: ref401, error: err401 } = await supabase.auth.refreshSession();
    if (!err401 && ref401.session?.access_token) {
      lastAuthRefreshWallMs = Date.now();
      token = ref401.session.access_token;
    } else {
      token = await getValidAccessTokenForFunctions();
    }
    out = await postBatchWithWorkerRetry(url, bodyJson, token, anon);
  }

  return out;
}

/**
 * Reinvoca o processor até o lote sair de PROCESSING ou não restarem ficheiros.
 * Usar após Focus sync / ZIP enqueue quando o encadeamento no servidor não é confiável.
 */
export async function drainProcessImportJobBatch(
  batchId: string,
  options?: { maxRounds?: number; pauseMs?: number; test_single_file?: boolean },
): Promise<{ ok: boolean; error?: string; last?: ProcessImportJobBatchResponse }> {
  const maxRounds = options?.maxRounds ?? 200;
  const pauseMs = options?.pauseMs ?? 400;
  let last: ProcessImportJobBatchResponse | undefined;
  let workerStalls = 0;

  for (let i = 0; i < maxRounds; i += 1) {
    const { res, data } = await invokeProcessImportJobBatch(batchId, {
      test_single_file: options?.test_single_file === true ? true : undefined,
    });
    last = data;

    if (!res.ok || data.ok === false) {
      if (BATCH_RETRYABLE_HTTP.has(res.status)) {
        workerStalls += 1;
        if (workerStalls > 22) {
          return {
            ok: false,
            error:
              data.error ??
              `HTTP ${res.status} — limite do worker ou gateway repetido; tente mais tarde ou reduza ficheiros por lote.`,
            last,
          };
        }
        await sleep(Math.min(22_000, 4_000 + workerStalls * 1_800));
        i -= 1;
        continue;
      }
      workerStalls = 0;
      return {
        ok: false,
        error: data.error ?? `HTTP ${res.status}`,
        last,
      };
    }
    workerStalls = 0;
    if (data.cancelled) {
      return { ok: true, last };
    }
    const st = String(data.status ?? "");
    const rem = Number(data.remaining_files ?? 0);
    const stillProcessing =
      st === "PROCESSING" && Number.isFinite(rem) && rem > 0;
    if (!stillProcessing) {
      return { ok: true, last };
    }
    await sleep(pauseMs);
  }

  return {
    ok: false,
    error:
      "Limite de rodadas no navegador — o lote pode ainda ter ficheiros. Abra a central de importações ou tente de novo.",
    last,
  };
}

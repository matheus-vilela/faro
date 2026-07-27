/**
 * Orquestração do import CSV Epoc: claim/heartbeat + chamada ao processador de chunks
 * + self-call. Substitui a continuação frágil via pgmq fire-and-forget.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const EPOC_CSV_IMPORT_STALE_SECONDS = 120;
export const EPOC_CSV_IMPORT_WORKER_PATH = "epoc-csv-import-worker";

export type ClaimAction = "claim" | "renew" | "reclaim" | "alive" | "terminal";

export type ClaimResult = {
  job_id: string;
  worker_token: string | null;
  status: string;
  csv_resume_row_index: number;
  action: ClaimAction;
};

export type ProcessChunkResult = {
  ok: boolean;
  continuing?: boolean;
  phase?: string;
  error?: string;
  status: number;
  body: Record<string, unknown>;
};

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

export async function claimEpocCsvImportJob(
  admin: SupabaseClient,
  jobId: string,
  workerToken?: string | null,
  staleSeconds = EPOC_CSV_IMPORT_STALE_SECONDS,
): Promise<ClaimResult | null> {
  const { data, error } = await admin.rpc("epoc_csv_import_claim", {
    p_job_id: jobId,
    p_worker_token: workerToken ?? null,
    p_stale_seconds: staleSeconds,
  });
  if (error) {
    console.error("[epocCsvImportOrchestrator] claim", error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.job_id) return null;
  return {
    job_id: String(row.job_id),
    worker_token: row.worker_token != null ? String(row.worker_token) : null,
    status: String(row.status ?? ""),
    csv_resume_row_index: Number(row.csv_resume_row_index ?? 0) || 0,
    action: String(row.action ?? "claim") as ClaimAction,
  };
}

export async function heartbeatEpocCsvImportJob(
  admin: SupabaseClient,
  jobId: string,
  workerToken: string,
): Promise<boolean> {
  const { data, error } = await admin.rpc("epoc_csv_import_heartbeat", {
    p_job_id: jobId,
    p_worker_token: workerToken,
  });
  if (error) {
    console.warn("[epocCsvImportOrchestrator] heartbeat", error.message);
    return false;
  }
  return data === true;
}

export async function pickStaleEpocCsvImportJobs(
  admin: SupabaseClient,
  limit = 5,
  staleSeconds = EPOC_CSV_IMPORT_STALE_SECONDS,
): Promise<string[]> {
  const { data, error } = await admin.rpc("epoc_csv_import_pick_stale", {
    p_limit: limit,
    p_stale_seconds: staleSeconds,
  });
  if (error) {
    console.warn("[epocCsvImportOrchestrator] pick_stale", error.message);
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data
    .map((r: { job_id?: string }) => String(r.job_id ?? "").trim())
    .filter(Boolean);
}

/** Processa um “turno” de chunks via edge existente (lógica pesada de CSV/receitas). */
export async function runCsvImportChunkSession(
  supabaseUrl: string,
  serviceKey: string,
  jobId: string,
  opts?: { resume?: boolean; timeoutMs?: number; logTag?: string },
): Promise<ProcessChunkResult> {
  const url =
    `${supabaseUrl.replace(/\/$/, "")}/functions/v1/process-integration-csv-revenue-job`;
  const timeoutMs = opts?.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const logTag = opts?.logTag ?? "[epocCsvImportOrchestrator]";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        job_id: jobId,
        resume: opts?.resume === true,
        orchestrated: true,
        defer_continue_enqueue: true,
      }),
      signal: controller.signal,
    });
    const raw = await res.text();
    let body: Record<string, unknown> = {};
    if (raw.trim()) {
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        body = { raw: raw.slice(0, 500) };
      }
    }
    if (!res.ok) {
      console.error(logTag, "chunk_session_http", {
        job_id: jobId,
        status: res.status,
        body,
      });
      return {
        ok: false,
        status: res.status,
        body,
        error: typeof body.error === "string"
          ? body.error
          : `HTTP ${res.status}`,
      };
    }
    return {
      ok: body.ok !== false,
      continuing: body.continuing === true,
      phase: typeof body.phase === "string" ? body.phase : undefined,
      status: res.status,
      body,
      error: typeof body.error === "string" ? body.error : undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(logTag, "chunk_session_erro", { job_id: jobId, message: msg });
    return { ok: false, status: 0, body: {}, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** Self-call do orquestrador (continuação). */
export function selfInvokeEpocCsvImportWorker(
  supabaseUrl: string,
  authBearer: string,
  body: Record<string, unknown>,
  logTag = "[epocCsvImportOrchestrator]",
): void {
  const url =
    `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${EPOC_CSV_IMPORT_WORKER_PATH}`;
  const p = fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authBearer}`,
      apikey: authBearer,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }).then(async (res) => {
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      console.error(logTag, "self_invoke_http", res.status, raw.slice(0, 300));
    }
  }).catch((e) => {
    console.error(logTag, "self_invoke_erro", String(e));
  });
  scheduleWaitUntil(p);
}

/** Kick externo (sync/pipeline/UI) → orquestrador. */
export async function triggerEpocCsvImportWorker(
  supabaseUrl: string,
  serviceKey: string,
  jobId: string,
  opts?: { timeoutMs?: number; logTag?: string; workerToken?: string },
): Promise<{ ok: boolean; status?: number; body?: unknown; error?: string }> {
  const url =
    `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${EPOC_CSV_IMPORT_WORKER_PATH}`;
  const timeoutMs = opts?.timeoutMs ?? 55_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const logTag = opts?.logTag ?? "[triggerEpocCsvImportWorker]";
  const body: Record<string, unknown> = { job_id: jobId };
  if (opts?.workerToken) body.worker_token = opts.workerToken;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await res.text();
    let parsed: unknown = raw;
    if (raw.trim()) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        /* keep text */
      }
    }
    if (!res.ok) {
      console.error(logTag, "http_error", { job_id: jobId, status: res.status, body: parsed });
      return { ok: false, status: res.status, body: parsed, error: `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status, body: parsed };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(logTag, "fetch_failed", { job_id: jobId, message: msg });
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

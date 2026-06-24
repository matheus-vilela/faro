/** Dispara `process-integration-csv-revenue-job` (claim inicial ou resume). */

export type TriggerCsvRevenueImportResult = {
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
};

export async function triggerCsvRevenueImportJob(
  supabaseUrl: string,
  serviceKey: string,
  _anonKey: string,
  jobId: string,
  opts?: {
    resume?: boolean;
    timeoutMs?: number;
    logTag?: string;
  },
): Promise<TriggerCsvRevenueImportResult> {
  const url =
    `${supabaseUrl.replace(/\/$/, "")}/functions/v1/process-integration-csv-revenue-job`;
  const timeoutMs = opts?.timeoutMs ?? 55_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const logTag = opts?.logTag ?? "[triggerCsvRevenueImportJob]";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        // Gateway exige a mesma chave em Authorization e apikey (evita 401 Conflicting API keys).
        apikey: serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        job_id: jobId,
        ...(opts?.resume ? { resume: true } : {}),
      }),
      signal: controller.signal,
    });
    const raw = await res.text();
    let body: unknown = raw;
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        /* manter texto */
      }
    }
    if (!res.ok) {
      console.error(logTag, "http_error", {
        job_id: jobId,
        status: res.status,
        body,
      });
      return {
        ok: false,
        status: res.status,
        body,
        error: `HTTP ${res.status}`,
      };
    }
    return { ok: true, status: res.status, body };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(logTag, "fetch_failed", { job_id: jobId, message: msg });
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

/** Fire-and-forget com waitUntil (retomadas entre chunks). */
export function scheduleCsvRevenueImportJob(
  supabaseUrl: string,
  serviceKey: string,
  anonKey: string,
  jobId: string,
  opts?: { resume?: boolean; logTag?: string },
): void {
  const run = triggerCsvRevenueImportJob(
    supabaseUrl,
    serviceKey,
    anonKey,
    jobId,
    opts,
  ).catch((err) => {
    console.error(opts?.logTag ?? "[scheduleCsvRevenueImportJob]", {
      job_id: jobId,
      err: String(err),
    });
  });
  try {
    // @ts-ignore EdgeRuntime.waitUntil
    if (
      typeof EdgeRuntime !== "undefined" &&
      typeof EdgeRuntime.waitUntil === "function"
    ) {
      // @ts-ignore
      EdgeRuntime.waitUntil(run);
      return;
    }
  } catch {
    /* ignore */
  }
  void run;
}

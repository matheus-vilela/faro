/** Dispara `process-integration-csv-revenue-job` (claim inicial). Continuações usam fila pgmq. */

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
      body: JSON.stringify({ job_id: jobId }),
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

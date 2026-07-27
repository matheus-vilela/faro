/** Fila pgmq `csv_revenue_import_continue` — continuação de chunks do import CSV EPOC. */

export const CSV_REVENUE_IMPORT_QUEUE_NAME = "csv_revenue_import_continue";

export type CsvRevenueImportQueueMessage = {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  vt: string;
  message: {
    job_id?: string;
    action?: string;
  };
};

// deno-lint-ignore no-explicit-any
type Admin = any;

export type EnqueueCsvRevenueImportContinueResult = {
  ok: boolean;
  msgId?: number;
  error?: string;
};

export async function sendCsvRevenueImportContinueMessage(
  admin: Admin,
  jobId: string,
): Promise<EnqueueCsvRevenueImportContinueResult> {
  const { data, error } = await admin.rpc("csv_revenue_import_queue_send", {
    p_job_id: jobId,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  const msgId = Number(data);
  if (!Number.isFinite(msgId)) {
    return { ok: false, error: "RPC send não devolveu msg_id." };
  }
  return { ok: true, msgId };
}

export async function readCsvRevenueImportContinueMessages(
  admin: Admin,
  n: number,
  vtSeconds = 300,
): Promise<CsvRevenueImportQueueMessage[]> {
  const { data, error } = await admin.rpc("csv_revenue_import_queue_read", {
    p_n: n,
    p_vt: vtSeconds,
  });
  if (error) {
    console.error("[csvRevenueImportQueue] read_erro", error.message);
    return [];
  }
  return (Array.isArray(data) ? data : []) as CsvRevenueImportQueueMessage[];
}

export async function deleteCsvRevenueImportContinueMessage(
  admin: Admin,
  msgId: number,
): Promise<boolean> {
  const { data, error } = await admin.rpc("csv_revenue_import_queue_delete", {
    p_msg_id: msgId,
  });
  if (error) {
    console.error("[csvRevenueImportQueue] delete_erro", {
      msg_id: msgId,
      error: error.message,
    });
    return false;
  }
  return data === true;
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

/** Dispara consumer imediato (`consume_queue: true`). */
export function triggerCsvRevenueImportWorker(
  supabaseUrl: string,
  serviceKey: string,
  logTag = "[csvRevenueImportQueue]",
): void {
  void triggerCsvRevenueImportWorkerAwait(supabaseUrl, serviceKey, logTag);
}

/**
 * Aguarda o consumer arrancar (até timeout). Usa waitUntil como rede de segurança
 * se o isolate morrer a seguir — evita ficar preso em 20/N quando o fire-and-forget falha.
 */
export async function triggerCsvRevenueImportWorkerAwait(
  supabaseUrl: string,
  serviceKey: string,
  logTag = "[csvRevenueImportQueue]",
  timeoutMs = 45_000,
): Promise<{ ok: boolean; error?: string }> {
  const base = supabaseUrl.replace(/\/$/, "");
  const url = `${base}/functions/v1/process-integration-csv-revenue-job`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const p = (async () => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ consume_queue: true }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const raw = await res.text().catch(() => "");
        console.error(logTag, "worker_trigger_http", res.status, raw.slice(0, 300));
        return { ok: false as const, error: `HTTP ${res.status}` };
      }
      return { ok: true as const };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(logTag, "worker_trigger_erro", msg);
      return { ok: false as const, error: msg };
    } finally {
      clearTimeout(timer);
    }
  })();

  // Rede de segurança se o caller não puder await até ao fim.
  scheduleWaitUntil(p);
  return await p;
}

export async function enqueueCsvRevenueImportContinue(
  admin: Admin,
  jobId: string,
  opts?: {
    triggerWorker?: boolean;
    supabaseUrl?: string;
    serviceKey?: string;
    logTag?: string;
    /**
     * Se true, espera o consumer HTTP. Default false (fire-and-forget + waitUntil)
     * para não aninhar invocações longas; o cron/`close_cycle` fazem pump.
     */
    awaitWorker?: boolean;
  },
): Promise<EnqueueCsvRevenueImportContinueResult> {
  const send = await sendCsvRevenueImportContinueMessage(admin, jobId);
  if (!send.ok) {
    return send;
  }

  if (opts?.triggerWorker && opts.supabaseUrl && opts.serviceKey) {
    if (opts.awaitWorker === true) {
      const trig = await triggerCsvRevenueImportWorkerAwait(
        opts.supabaseUrl,
        opts.serviceKey,
        opts.logTag,
      );
      if (!trig.ok) {
        console.warn(
          opts.logTag ?? "[csvRevenueImportQueue]",
          "worker_trigger_falhou_mas_msg_na_fila",
          { job_id: jobId, error: trig.error },
        );
      }
    } else {
      triggerCsvRevenueImportWorker(
        opts.supabaseUrl,
        opts.serviceKey,
        opts.logTag,
      );
    }
  }

  return send;
}

/** Retoma job PROCESSING enfileirando continuação (substitui POST resume). */
export async function resumeCsvRevenueImportViaQueue(
  admin: Admin,
  jobId: string,
  opts: {
    supabaseUrl: string;
    serviceKey: string;
    logTag?: string;
  },
): Promise<EnqueueCsvRevenueImportContinueResult> {
  return enqueueCsvRevenueImportContinue(admin, jobId, {
    triggerWorker: true,
    supabaseUrl: opts.supabaseUrl,
    serviceKey: opts.serviceKey,
    logTag: opts.logTag,
  });
}

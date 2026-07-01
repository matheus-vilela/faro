/** Fila pgmq `focus_interpret_staging_continue` — continuação de chunks do interpret staging. */

export const INTERPRET_STAGING_QUEUE_NAME = "focus_interpret_staging_continue";

export type InterpretStagingQueueMessage = {
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

export type EnqueueInterpretStagingContinueResult = {
  ok: boolean;
  msgId?: number;
  error?: string;
};

export async function sendInterpretStagingContinueMessage(
  admin: Admin,
  jobId: string,
): Promise<EnqueueInterpretStagingContinueResult> {
  const { data, error } = await admin.rpc("focus_interpret_staging_queue_send", {
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

export async function readInterpretStagingContinueMessages(
  admin: Admin,
  n: number,
  vtSeconds = 300,
): Promise<InterpretStagingQueueMessage[]> {
  const { data, error } = await admin.rpc("focus_interpret_staging_queue_read", {
    p_n: n,
    p_vt: vtSeconds,
  });
  if (error) {
    console.error("[interpretStagingQueue] read_erro", error.message);
    return [];
  }
  return (Array.isArray(data) ? data : []) as InterpretStagingQueueMessage[];
}

export async function deleteInterpretStagingContinueMessage(
  admin: Admin,
  msgId: number,
): Promise<boolean> {
  const { data, error } = await admin.rpc(
    "focus_interpret_staging_queue_delete",
    { p_msg_id: msgId },
  );
  if (error) {
    console.error("[interpretStagingQueue] delete_erro", {
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

/** Dispara consumer imediato (cron continua como rede de segurança). */
export function triggerInterpretStagingWorker(
  supabaseUrl: string,
  bearerSecret: string,
  apiKey: string,
  log?: (phase: string, payload: Record<string, unknown>) => void,
): void {
  const base = supabaseUrl.replace(/\/$/, "");
  const url = `${base}/functions/v1/focus-get-sync-nfe-interpret-staging`;
  const p = fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearerSecret}`,
      apikey: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  }).catch((e) => {
    log?.("worker_trigger_erro", { error: String(e) });
  });

  scheduleWaitUntil(p);
  log?.("worker_trigger_agendado", {});
}

export async function enqueueInterpretStagingContinue(
  admin: Admin,
  jobId: string,
  opts?: {
    triggerWorker?: boolean;
    supabaseUrl?: string;
    bearerSecret?: string;
    apiKey?: string;
    log?: (phase: string, payload: Record<string, unknown>) => void;
  },
): Promise<EnqueueInterpretStagingContinueResult> {
  const send = await sendInterpretStagingContinueMessage(admin, jobId);
  if (!send.ok) {
    return send;
  }

  opts?.log?.("fila_continuacao_enfileirada", {
    job_id: jobId,
    msg_id: send.msgId ?? null,
  });

  if (
    opts?.triggerWorker &&
    opts.supabaseUrl &&
    opts.bearerSecret &&
    opts.apiKey
  ) {
    triggerInterpretStagingWorker(
      opts.supabaseUrl,
      opts.bearerSecret,
      opts.apiKey,
      opts.log,
    );
  }

  return send;
}

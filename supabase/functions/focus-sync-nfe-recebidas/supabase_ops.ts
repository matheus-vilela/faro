import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { LOG } from "./constants.ts";
import { marcador, slog, slogV } from "./log.ts";

export function scheduleWaitUntil(p: Promise<unknown>): void {
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

export function kickProcessImportJobBatch(
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

export async function countPendingQueue(
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

export async function persistFocusnfe(
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

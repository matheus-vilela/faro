import { supabase } from "@/lib/supabase";

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

export async function invokeProcessImportJobBatch(
  batchId: string,
): Promise<{ res: Response; data: ProcessImportJobBatchResponse }> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) {
    throw new Error("Sessão inválida.");
  }
  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const url = `${baseUrl.replace(/\/$/, "")}/functions/v1/process-import-job-batch`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: anon,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ batch_id: batchId }),
  });
  const data = (await res.json().catch(() => ({}))) as ProcessImportJobBatchResponse;
  return { res, data };
}

/**
 * Reinvoca o processor até o lote sair de PROCESSING ou não restarem ficheiros.
 * Usar após Focus sync / ZIP enqueue quando o encadeamento no servidor não é confiável.
 */
export async function drainProcessImportJobBatch(
  batchId: string,
  options?: { maxRounds?: number; pauseMs?: number },
): Promise<{ ok: boolean; error?: string; last?: ProcessImportJobBatchResponse }> {
  const maxRounds = options?.maxRounds ?? 200;
  const pauseMs = options?.pauseMs ?? 400;
  let last: ProcessImportJobBatchResponse | undefined;

  for (let i = 0; i < maxRounds; i += 1) {
    const { res, data } = await invokeProcessImportJobBatch(batchId);
    last = data;
    if (!res.ok || data.ok === false) {
      return {
        ok: false,
        error: data.error ?? `HTTP ${res.status}`,
        last,
      };
    }
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
    await new Promise((r) => globalThis.setTimeout(r, pauseMs));
  }

  return {
    ok: false,
    error:
      "Limite de rodadas no navegador — o lote pode ainda ter ficheiros. Abra a central de importações ou tente de novo.",
    last,
  };
}

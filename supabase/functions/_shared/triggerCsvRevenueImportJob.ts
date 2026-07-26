/**
 * Dispara o orquestrador `epoc-csv-import-worker` (heartbeat + self-call + watchdog).
 * O processador pesado de chunks continua em process-integration-csv-revenue-job.
 */
import { triggerEpocCsvImportWorker } from "./epocCsvImportOrchestrator.ts";

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
  return triggerEpocCsvImportWorker(supabaseUrl, serviceKey, jobId, {
    timeoutMs: opts?.timeoutMs,
    logTag: opts?.logTag ?? "[triggerCsvRevenueImportJob]",
  });
}

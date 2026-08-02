/**
 * Após o job de importação terminar, atualiza o flow_diagnostic congelado
 * no epoc_csv_sync_runs correspondente (evita fase 4 «Em curso» para sempre).
 */

// deno-lint-ignore no-explicit-any
type Admin = any;

import {
  applyImportOutcomeToSyncFlowDiagnostic,
  type EpocFlowDiagnostic,
} from "./epocFlowDiagnostic.ts";

export async function patchEpocCsvSyncRunFlowDiagnosticFromImportJob(
  admin: Admin,
  input: {
    jobId: string;
    importFlowDiagnostic: EpocFlowDiagnostic;
    /** Se o job já guarda o id do sync_run. */
    epocCsvSyncRunId?: string | null;
  },
): Promise<void> {
  const jobId = input.jobId.trim();
  if (!jobId) return;

  const runs: Array<{ id: string; metadata: unknown }> = [];

  const syncRunId =
    typeof input.epocCsvSyncRunId === "string"
      ? input.epocCsvSyncRunId.trim()
      : "";
  if (syncRunId) {
    const { data } = await admin
      .from("epoc_csv_sync_runs")
      .select("id, metadata")
      .eq("id", syncRunId)
      .maybeSingle();
    if (data?.id) runs.push(data);
  }

  if (runs.length === 0) {
    const { data } = await admin
      .from("epoc_csv_sync_runs")
      .select("id, metadata")
      .filter("metadata->>csv_revenue_import_job_id", "eq", jobId)
      .limit(5);
    for (const row of data ?? []) {
      if (row?.id) runs.push(row);
    }
  }

  for (const run of runs) {
    const meta =
      run.metadata &&
      typeof run.metadata === "object" &&
      !Array.isArray(run.metadata)
        ? ({ ...(run.metadata as Record<string, unknown>) } as Record<
            string,
            unknown
          >)
        : {};

    const existingFlow = meta.flow_diagnostic;
    let nextFlow: EpocFlowDiagnostic = input.importFlowDiagnostic;
    if (
      existingFlow &&
      typeof existingFlow === "object" &&
      !Array.isArray(existingFlow) &&
      (existingFlow as EpocFlowDiagnostic).phases &&
      (existingFlow as EpocFlowDiagnostic).summary
    ) {
      nextFlow = applyImportOutcomeToSyncFlowDiagnostic(
        existingFlow as EpocFlowDiagnostic,
        input.importFlowDiagnostic,
      );
    }

    if (
      existingFlow &&
      typeof existingFlow === "object" &&
      JSON.stringify(existingFlow) === JSON.stringify(nextFlow)
    ) {
      continue;
    }

    const { error } = await admin
      .from("epoc_csv_sync_runs")
      .update({
        metadata: {
          ...meta,
          flow_diagnostic: nextFlow,
        },
      })
      .eq("id", run.id);

    if (error) {
      console.warn(
        "[patchEpocCsvSyncRunFlowDiagnostic] update_falhou",
        { sync_run_id: run.id, job_id: jobId, message: error.message },
      );
    }
  }
}

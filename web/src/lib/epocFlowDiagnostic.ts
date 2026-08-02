export {
  applyImportOutcomeToSyncFlowDiagnostic,
  buildEpocImportJobFlowDiagnostic,
  buildEpocSyncFlowDiagnostic,
  EPOC_FLOW_PHASE_LABELS,
  EPOC_FLOW_PHASE_ORDER,
  type EpocFlowDiagnostic,
  type EpocFlowPhase,
  type EpocFlowPhaseReport,
  type EpocFlowPhaseStatus,
  type EpocImportJobFlowDiagnosticInput,
  type EpocSyncFlowDiagnosticInput,
} from "../../../supabase/functions/_shared/epocFlowDiagnostic.ts";

import {
  applyImportOutcomeToSyncFlowDiagnostic,
  buildEpocImportJobFlowDiagnostic,
  buildEpocSyncFlowDiagnostic,
  type EpocFlowDiagnostic,
  type EpocFlowPhaseStatus,
} from "../../../supabase/functions/_shared/epocFlowDiagnostic.ts";

export function epocFlowPhaseStatusLabel(status: EpocFlowPhaseStatus): string {
  if (status === "ok") return "OK";
  if (status === "warn") return "Atenção";
  if (status === "fail") return "Falha";
  if (status === "pending") return "Em curso";
  return "—";
}

export function epocFlowBlockedPhaseLabel(
  diagnostic: EpocFlowDiagnostic,
): string | null {
  if (!diagnostic.blocked_at) return null;
  const report = diagnostic.phases[diagnostic.blocked_at];
  return report?.label ?? diagnostic.blocked_at;
}

export type LinkedEpocImportJobForDiagnostic = {
  status: string;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
};

function importJobFlowDiagnosticFromRow(
  job: LinkedEpocImportJobForDiagnostic,
): EpocFlowDiagnostic {
  const meta = job.metadata ?? {};
  const metaFlow = meta.flow_diagnostic;
  if (metaFlow && typeof metaFlow === "object" && !Array.isArray(metaFlow)) {
    const d = metaFlow as EpocFlowDiagnostic;
    if (d.phases && d.summary) return d;
  }
  return buildEpocImportJobFlowDiagnostic({
    status: job.status,
    errorMessage: job.errorMessage,
    csvTotalRows: Number(meta.csv_total_data_rows ?? 0) || 0,
    revenueCreated: Number(meta.revenue_entries_created_total ?? 0) || 0,
    rowsSkipped: Number(meta.rows_skipped_total ?? 0) || 0,
    rowsSkippedNoProduct: Number(meta.rows_skipped_no_product ?? 0) || 0,
  });
}

function withLinkedImportJob(
  syncDiagnostic: EpocFlowDiagnostic,
  linkedImportJob?: LinkedEpocImportJobForDiagnostic | null,
): EpocFlowDiagnostic {
  if (!linkedImportJob) return syncDiagnostic;
  return applyImportOutcomeToSyncFlowDiagnostic(
    syncDiagnostic,
    importJobFlowDiagnosticFromRow(linkedImportJob),
  );
}

/** Infere diagnóstico a partir de metadata legada (runs/jobs antigos). */
export function inferEpocFlowDiagnosticFromLegacy(input: {
  kind: "sync_run";
  outcome: string;
  summary: string;
  metadata?: Record<string, unknown> | null;
  /** Job ligado via metadata.csv_revenue_import_job_id (evita fase 4 stale). */
  linkedImportJob?: LinkedEpocImportJobForDiagnostic | null;
}): EpocFlowDiagnostic;
export function inferEpocFlowDiagnosticFromLegacy(input: {
  kind: "import_job";
  status: string;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
}): EpocFlowDiagnostic;
export function inferEpocFlowDiagnosticFromLegacy(
  input:
    | {
        kind: "sync_run";
        outcome: string;
        summary: string;
        metadata?: Record<string, unknown> | null;
        linkedImportJob?: LinkedEpocImportJobForDiagnostic | null;
      }
    | {
        kind: "import_job";
        status: string;
        errorMessage?: string | null;
        metadata?: Record<string, unknown> | null;
      },
): EpocFlowDiagnostic {
  if (input.kind === "import_job") {
    return importJobFlowDiagnosticFromRow({
      status: input.status,
      errorMessage: input.errorMessage,
      metadata: input.metadata,
    });
  }

  const metaFlow = input.metadata?.flow_diagnostic;
  if (metaFlow && typeof metaFlow === "object" && !Array.isArray(metaFlow)) {
    const d = metaFlow as EpocFlowDiagnostic;
    if (d.phases && d.summary) {
      return withLinkedImportJob(d, input.linkedImportJob);
    }
  }

  const meta = input.metadata ?? {};
  const outcome = input.outcome;
  const summary = input.summary;

  if (outcome === "no_tbl_export") {
    return withLinkedImportJob(
      buildEpocSyncFlowDiagnostic({
        loginOk: true,
        tblExportFound: false,
        portalSearchSummary: summary,
        diasConsultados: Array.isArray(input.metadata?.dias_consultados)
          ? (input.metadata!.dias_consultados as unknown[]).length
          : undefined,
      }),
      input.linkedImportJob,
    );
  }

  if (outcome === "success") {
    return withLinkedImportJob(
      buildEpocSyncFlowDiagnostic({
        loginOk: true,
        tblExportFound: true,
        csvUploaded: meta.tbl_export_found !== false,
        linhasDados: Number(meta.linhas_dados ?? 0) || undefined,
        diasComTabela: Number(meta.dias_com_tabela ?? 0) || undefined,
        csvRevenueImportJobId:
          typeof meta.csv_revenue_import_job_id === "string"
            ? meta.csv_revenue_import_job_id
            : null,
      }),
      input.linkedImportJob,
    );
  }

  return withLinkedImportJob(
    buildEpocSyncFlowDiagnostic({
      loginOk: outcome !== "failed",
      syncOk: false,
      syncError: summary,
    }),
    input.linkedImportJob,
  );
}

export {
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
  buildEpocImportJobFlowDiagnostic,
  buildEpocSyncFlowDiagnostic,
  EPOC_FLOW_PHASE_LABELS,
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

/** Infere diagnóstico a partir de metadata legada (runs/jobs antigos). */
export function inferEpocFlowDiagnosticFromLegacy(input: {
  kind: "sync_run";
  outcome: string;
  summary: string;
  metadata?: Record<string, unknown> | null;
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
      }
    | {
        kind: "import_job";
        status: string;
        errorMessage?: string | null;
        metadata?: Record<string, unknown> | null;
      },
): EpocFlowDiagnostic {
  const metaFlow = input.metadata?.flow_diagnostic;
  if (metaFlow && typeof metaFlow === "object" && !Array.isArray(metaFlow)) {
    const d = metaFlow as EpocFlowDiagnostic;
    if (d.phases && d.summary) return d;
  }

  if (input.kind === "import_job") {
    const meta = input.metadata ?? {};
    return buildEpocImportJobFlowDiagnostic({
      status: input.status,
      errorMessage: input.errorMessage,
      csvTotalRows: Number(meta.csv_total_data_rows ?? 0) || 0,
      revenueCreated: Number(meta.revenue_entries_created_total ?? 0) || 0,
      rowsSkipped: Number(meta.rows_skipped_total ?? 0) || 0,
      rowsSkippedNoProduct: Number(meta.rows_skipped_no_product ?? 0) || 0,
    });
  }

  const meta = input.metadata ?? {};
  const outcome = input.outcome;
  const summary = input.summary;

  if (outcome === "no_tbl_export") {
    return buildEpocSyncFlowDiagnostic({
      loginOk: true,
      tblExportFound: false,
      portalSearchSummary: summary,
      diasConsultados: Array.isArray(input.metadata?.dias_consultados)
        ? (input.metadata!.dias_consultados as unknown[]).length
        : undefined,
    });
  }

  if (outcome === "success") {
    return buildEpocSyncFlowDiagnostic({
      loginOk: true,
      tblExportFound: true,
      csvUploaded: meta.tbl_export_found !== false,
      linhasDados: Number(meta.linhas_dados ?? 0) || undefined,
      diasComTabela: Number(meta.dias_com_tabela ?? 0) || undefined,
      csvRevenueImportJobId:
        typeof meta.csv_revenue_import_job_id === "string"
          ? meta.csv_revenue_import_job_id
          : null,
    });
  }

  return buildEpocSyncFlowDiagnostic({
    loginOk: outcome !== "failed",
    syncOk: false,
    syncError: summary,
  });
}

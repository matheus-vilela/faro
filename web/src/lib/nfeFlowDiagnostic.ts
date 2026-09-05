export {
  buildNfeCycleFlowDiagnostic,
  buildNfeQueuedFlowDiagnostic,
  canMarkOnboardingFiscalCompleted,
  NFE_FLOW_PHASE_LABELS,
  NFE_FLOW_PHASE_ORDER,
  type NfeCycleFlowDiagnosticInput,
  type NfeFlowDiagnostic,
  type NfeFlowPhase,
  type NfeFlowPhaseReport,
  type NfeFlowPhaseStatus,
} from "../../../supabase/functions/_shared/nfeFlowDiagnostic.ts";

import {
  buildNfeCycleFlowDiagnostic,
  type NfeFlowDiagnostic,
  type NfeFlowPhaseStatus,
} from "../../../supabase/functions/_shared/nfeFlowDiagnostic.ts";

export function nfeFlowPhaseStatusLabel(status: NfeFlowPhaseStatus): string {
  if (status === "ok") return "OK";
  if (status === "warn") return "Atenção";
  if (status === "fail") return "Falha";
  if (status === "pending") return "Em curso";
  return "—";
}

/** Infere diagnóstico a partir da linha de histórico (com ou sem snapshot). */
export function inferNfeFlowDiagnosticFromHistory(input: {
  summary?: string | null;
  flowDiagnostic?: unknown;
  nfesEncontradas: number;
  stagingXmlTotal?: number | null;
  listedCount?: number | null;
  downloadedCount?: number | null;
  processedCount?: number | null;
  failedCount?: number | null;
  ignoredCount?: number | null;
}): NfeFlowDiagnostic {
  const listed =
    input.listedCount != null
      ? Number(input.listedCount) || 0
      : Number(input.nfesEncontradas) || 0;
  const downloaded =
    input.downloadedCount != null
      ? Number(input.downloadedCount) || 0
      : Number(input.stagingXmlTotal ?? 0) || 0;
  const failed = Number(input.failedCount ?? 0) || 0;
  const ignored = Number(input.ignoredCount ?? 0) || 0;
  let processed = Number(input.processedCount ?? 0) || 0;

  const metaFlow = input.flowDiagnostic;
  const snapshotListExhausted =
    metaFlow && typeof metaFlow === "object" && !Array.isArray(metaFlow)
      ? (metaFlow as NfeFlowDiagnostic).list_exhausted
      : undefined;
  const hasCounters =
    input.processedCount != null || input.downloadedCount != null;
  if (metaFlow && typeof metaFlow === "object" && !Array.isArray(metaFlow)) {
    const d = metaFlow as NfeFlowDiagnostic;
    const searchFailed = d.phases?.nfe_search?.status === "fail";
    // Snapshot de busca falha prevalece; nos demais casos os contadores
    // atualizados vencem um flow_diagnostic gravado cedo (ex.: 0/N).
    if (d.phases && d.summary && (searchFailed || !hasCounters)) return d;
  }
  // Histórico legado sem contadores de interpretação: assume sucesso se baixou e não falhou.
  if (
    input.processedCount == null &&
    downloaded > 0 &&
    failed === 0
  ) {
    processed = downloaded;
  }

  return buildNfeCycleFlowDiagnostic({
    listed,
    downloaded,
    processFailed: failed,
    processed,
    ignored,
    listExhausted: processed > 0 ? true : snapshotListExhausted,
  });
}

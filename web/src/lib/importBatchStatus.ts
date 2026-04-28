/**
 * Rótulos em pt-BR para valores de `import_job_batches.status` / `import_job_files.status`.
 * Os valores salvos no banco permanecem em inglês (contrato estável).
 */
const LABELS: Record<string, string> = {
  QUEUED: "Na fila",
  PROCESSING: "Processando",
  COMPLETED: "Concluído",
  FAILED: "Falhou",
  PARTIAL_SUCCESS: "Concluído parcialmente",
  COMPLETED_WITH_PENDING_REVIEW: "Concluído com revisões pendentes",
  CANCELLED: "Cancelado",
};

export function importJobStatusLabel(status: string | null | undefined): string {
  const k = String(status ?? "").trim();
  if (!k) return "—";
  return LABELS[k] ?? k;
}

/** Rótulos para `XmlZipFileLogEntry.status` (wizard de ZIP). */
const FILE_LOG_LABELS: Record<string, string> = {
  success: "Concluído",
  needs_review: "Revisão pendente",
  validation_error: "Falha",
  duplicate: "Duplicado",
  cancelled: "Cancelado",
  read_error: "Erro ao ler",
};

export function importFileLogStatusLabel(status: string | null | undefined): string {
  const k = String(status ?? "").trim().toLowerCase();
  if (!k) return "—";
  return FILE_LOG_LABELS[k] ?? k;
}

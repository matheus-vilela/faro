/**
 * Sinaliza no browser que `epoc-sync-csv` está a correr (antes de existir
 * `integration_csv_revenue_import_jobs`). Usado pelo dashboard para mostrar
 * progresso quando o utilizador sai da página Integrações durante a sync.
 */
const KEY_PREFIX = "faro:epocCsvSyncPending:";
const MAX_AGE_MS = 45 * 60 * 1000;

function key(companyId: string): string {
  return KEY_PREFIX + companyId;
}

export function markEpocCsvSyncPending(companyId: string): void {
  try {
    localStorage.setItem(key(companyId), String(Date.now()));
  } catch {
    /* quota / private mode */
  }
}

export function clearEpocCsvSyncPending(companyId: string): void {
  try {
    localStorage.removeItem(key(companyId));
  } catch {
    /* ignore */
  }
}

export function readEpocCsvSyncPending(companyId: string): boolean {
  try {
    const v = localStorage.getItem(key(companyId));
    if (!v) return false;
    const t = Number(v);
    if (!Number.isFinite(t) || Date.now() - t > MAX_AGE_MS) {
      localStorage.removeItem(key(companyId));
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

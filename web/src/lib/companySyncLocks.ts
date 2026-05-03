/** Colunas `companies.syncing_fiscal` / `syncing_pdv` (onboarding + UI). */

export function isFiscalSyncInProgress(
  syncingFiscal: boolean | null | undefined,
): boolean {
  return syncingFiscal === true;
}

export function isPdvSyncInProgress(
  syncingPdv: boolean | null | undefined,
): boolean {
  return syncingPdv === true;
}

/** Texto legado / heurística para mensagens de “ocupado”. */
export const FISCAL_SYNC_CONFLICT_MESSAGE =
  "Sincronização fiscal já em curso para esta unidade.";

export const PDV_SYNC_CONFLICT_MESSAGE =
  "Sincronização EPOC já em curso para esta unidade.";

export function isPdvSyncConflictError(message: string | undefined): boolean {
  if (!message?.trim()) return false;
  return message.includes("já em curso");
}

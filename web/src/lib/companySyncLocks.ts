/** Travas de sync: fiscal via `onboarding_fiscal`; PDV via `onboarding_pdv.sync`. */

import {
  isFiscalOnboardingSyncInProgress,
} from "@/lib/onboardingFiscalDashboard";
import { isOnboardingPdvSyncInProgress } from "@/lib/onboardingPdvDefaults";

export function isFiscalSyncInProgress(onboardingFiscal: unknown): boolean {
  return isFiscalOnboardingSyncInProgress(onboardingFiscal);
}

export function isPdvSyncInProgress(onboardingPdv: unknown): boolean {
  return isOnboardingPdvSyncInProgress(onboardingPdv);
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

import type { Company } from "@/contexts/CompanyContext";
import { isOnboardingPdvSyncInProgress } from "@/lib/onboardingPdvDefaults";

type OnboardingPdvSlice = Company["onboarding_pdv"];

/**
 * Bloqueia botões de sync manual enquanto portal, import ou `onboarding_pdv.sync` estão ativos.
 * Estado vem de `companies.onboarding_pdv` (Realtime / refetch).
 */
export function isEpocCsvSyncUiBusy(
  _companyId: string,
  opts?: { localSyncing?: boolean; onboardingPdv?: OnboardingPdvSlice },
): boolean {
  if (opts?.localSyncing) return true;
  const ob = opts?.onboardingPdv;
  if (!ob) return false;
  if (isOnboardingPdvSyncInProgress(ob)) return true;
  if (ob.portal_busy === true) return true;
  const st = ob.import_status;
  return st === "pending" || st === "processing";
}

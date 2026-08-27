import {
  isFiscalOnboardingSyncInProgress,
  isOnboardingFiscalFlowCompleted,
  isOnboardingFiscalInterpretConfirmPhase,
  isOnboardingFiscalSearchingNotes,
  isOnboardingFiscalSefazUnavailable,
} from "@/lib/onboardingFiscalDashboard";
import {
  isOnboardingPdvAwaitingEpocSync,
  isOnboardingPdvConfirmPhase,
  isOnboardingPdvPortalFailure,
  isOnboardingPdvProcessingSales,
  parseOnboardingPdv,
} from "@/lib/onboardingPdvDashboard";
import { isOnboardingPdvJsonCompleted } from "@/lib/onboardingPdvDefaults";

export type CorrelationOnboardingStepStatus =
  | "idle"
  | "processing"
  | "success"
  | "alert"
  | "error";

/** Estado do ponto «Onboarding fiscal concluído». */
export function correlationFiscalStepStatus(
  raw: unknown,
): CorrelationOnboardingStepStatus {
  if (isOnboardingFiscalFlowCompleted(raw)) return "success";
  if (isOnboardingFiscalSefazUnavailable(raw)) return "alert";
  if (isOnboardingFiscalInterpretConfirmPhase(raw)) return "alert";
  if (
    isFiscalOnboardingSyncInProgress(raw) ||
    isOnboardingFiscalSearchingNotes(raw)
  ) {
    return "processing";
  }
  return "idle";
}

/** Estado do ponto «Onboarding do PDV concluído». */
export function correlationPdvStepStatus(
  raw: unknown,
): CorrelationOnboardingStepStatus {
  if (isOnboardingPdvJsonCompleted(raw)) return "success";
  const o = parseOnboardingPdv(raw);
  if (o.import_status === "failed") return "error";
  if (isOnboardingPdvPortalFailure(raw)) return "error";
  if (isOnboardingPdvConfirmPhase(raw)) return "alert";
  if (
    o.portal_busy ||
    isOnboardingPdvProcessingSales(raw) ||
    isOnboardingPdvAwaitingEpocSync(raw) ||
    o.sync
  ) {
    return "processing";
  }
  return "idle";
}

export function correlationOnboardingCanStart(
  onboardingFiscal: unknown,
  onboardingPdv: unknown,
): boolean {
  return (
    isOnboardingFiscalFlowCompleted(onboardingFiscal) &&
    isOnboardingPdvJsonCompleted(onboardingPdv)
  );
}

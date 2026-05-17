export function syncFlagIsExplicitOff(v: unknown): boolean {
  return v === false || v === "false" || v === 0 || v === "0";
}

function syncFlagIsOn(v: unknown): boolean {
  if (v === true || v === "true" || v === 1 || v === "1") return true;
  if (syncFlagIsExplicitOff(v)) return false;
  return typeof v === "string" ? v.trim().toLowerCase() === "true" : false;
}

function onboardingFiscalObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

/** `onboarding_fiscal.completed === true`. */
export function isOnboardingFiscalJsonCompleted(raw: unknown): boolean {
  const o = onboardingFiscalObject(raw);
  if (!o) return false;
  return o.completed === true;
}

/** Etapa fiscal concluída (`onboarding_fiscal.completed`). */
export function isOnboardingFiscalFlowCompleted(raw: unknown): boolean {
  return isOnboardingFiscalJsonCompleted(raw);
}

/**
 * Card de NF-e / onboarding fiscal: fase de progresso com `sync` ativo (ou chave ausente).
 * Com `sync` explicitamente falso, usar `isOnboardingFiscalInterpretConfirmPhase` para confirmação.
 */
export function isOnboardingFiscalNfeRecebidasDashboardEnabled(raw: unknown): boolean {
  const o = onboardingFiscalObject(raw);
  if (!o) return true;
  if (!("sync" in o)) return true;
  const s = o.sync;
  if (s == null) return true;
  return syncFlagIsOn(s);
}

/**
 * Fase pós-interpretação: `sync` false (interpretação terminou) e `completed` ainda não true.
 */
export function isOnboardingFiscalInterpretConfirmPhase(raw: unknown): boolean {
  const o = onboardingFiscalObject(raw);
  if (!o) return false;
  if (!syncFlagIsExplicitOff(o.sync)) return false;
  if (isOnboardingFiscalJsonCompleted(raw)) return false;
  return true;
}

/** Sincronização fiscal em curso (`sync` ativo e etapa ainda não concluída). */
export function isFiscalOnboardingSyncInProgress(raw: unknown): boolean {
  return (
    isOnboardingFiscalNfeRecebidasDashboardEnabled(raw) &&
    !isOnboardingFiscalJsonCompleted(raw)
  );
}

/**
 * Card de onboarding fiscal no dashboard: só enquanto `onboarding_fiscal.completed` ≠ true.
 */
export function isOnboardingFiscalDashboardCardVisible(raw: unknown): boolean {
  return !isOnboardingFiscalJsonCompleted(raw);
}

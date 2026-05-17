/** Valores iniciais de `companies.onboarding_pdv` (alinhado às migrations). */
export const DEFAULT_ONBOARDING_PDV = {
  completed: false,
  sync: false,
} as const;

function onboardingPdvObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

export function defaultOnboardingPdvRecord(): Record<string, unknown> {
  return { ...DEFAULT_ONBOARDING_PDV };
}

export function mergeOnboardingPdv(
  raw: unknown,
  patch: Partial<{ completed: boolean; sync: boolean }>,
): Record<string, unknown> {
  const prev = onboardingPdvObject(raw) ?? {};
  return { ...prev, ...patch };
}

/** `onboarding_pdv.completed === true`. */
export function isOnboardingPdvJsonCompleted(raw: unknown): boolean {
  const o = onboardingPdvObject(raw);
  return o?.completed === true;
}

/** Sincronização EPOC/PDV em curso (`onboarding_pdv.sync === true`). */
export function isOnboardingPdvSyncInProgress(raw: unknown): boolean {
  const o = onboardingPdvObject(raw);
  return o?.sync === true;
}

/** Card de onboarding EPOC no dashboard: só enquanto `onboarding_pdv.completed` ≠ true. */
export function isOnboardingPdvDashboardCardVisible(raw: unknown): boolean {
  return !isOnboardingPdvJsonCompleted(raw);
}

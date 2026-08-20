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

/** Fase 1: XMLs da janela capturados (`capture_completed`). */
export function isOnboardingFiscalCaptureCompleted(raw: unknown): boolean {
  const o = onboardingFiscalObject(raw);
  if (!o) return false;
  return o.capture_completed === true;
}

/** Etapa fiscal concluída (`onboarding_fiscal.completed`). */
export function isOnboardingFiscalFlowCompleted(raw: unknown): boolean {
  return isOnboardingFiscalJsonCompleted(raw);
}

/**
 * Card de NF-e / onboarding fiscal: fase de progresso com `sync` ativo (listagem Focus ou interpretação XML).
 * `sync` só fica false sem notas em staging ou após job de interpretação `done`; então confirmação manual.
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
 * Fase legada de confirmação manual — desativada no pipeline novo
 * (`capture_completed` / `completed` são automáticos).
 */
export function isOnboardingFiscalInterpretConfirmPhase(raw: unknown): boolean {
  void raw;
  return false;
}

/** Sincronização fiscal em curso (`sync` ativo e captura/conclusão ainda pendentes). */
export function isFiscalOnboardingSyncInProgress(raw: unknown): boolean {
  return (
    isOnboardingFiscalNfeRecebidasDashboardEnabled(raw) &&
    !isOnboardingFiscalCaptureCompleted(raw) &&
    !isOnboardingFiscalJsonCompleted(raw)
  );
}

/**
 * Card de onboarding fiscal no dashboard: some só quando `completed === true`.
 * O pipeline só pode gravar `completed` depois da listagem Focus esgotar
 * e de todas as notas conhecidas serem interpretadas — senão o card some
 * no meio da importação (ex.: após a 1.ª página de ~50 NF-e).
 */
export function isOnboardingFiscalDashboardCardVisible(raw: unknown): boolean {
  return !isOnboardingFiscalJsonCompleted(raw);
}

/** SEFAZ/Focus indisponível no onboarding (`sefaz_unavailable === true`). */
export function isOnboardingFiscalSefazUnavailable(raw: unknown): boolean {
  const o = onboardingFiscalObject(raw);
  if (!o) return false;
  return o.sefaz_unavailable === true;
}

/** ISO do próximo retry automático (`sefaz_retry_at`), se existir. */
export function onboardingFiscalSefazRetryAt(raw: unknown): string | null {
  const o = onboardingFiscalObject(raw);
  if (!o) return null;
  const v = o.sefaz_retry_at;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

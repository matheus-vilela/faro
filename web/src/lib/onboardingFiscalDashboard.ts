export function syncFlagIsExplicitOff(v: unknown): boolean {
  return v === false || v === "false" || v === 0 || v === "0";
}

function syncFlagIsOn(v: unknown): boolean {
  if (v === true || v === "true" || v === 1 || v === "1") return true;
  if (syncFlagIsExplicitOff(v)) return false;
  return typeof v === "string" ? v.trim().toLowerCase() === "true" : false;
}

/**
 * Card de NF-e / onboarding fiscal: fase de progresso com `sync` ativo (ou chave ausente).
 * Com `sync` explicitamente falso, usar `isOnboardingFiscalInterpretConfirmPhase` para o passo de confirmação.
 */
export function isOnboardingFiscalNfeRecebidasDashboardEnabled(raw: unknown): boolean {
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  if (!o) return true;
  if (!("sync" in o)) return true;
  const s = o.sync;
  if (s == null) return true;
  return syncFlagIsOn(s);
}

/**
 * Fase pós-interpretação: `sync` foi posto a false pelo job de interpretação (onboarding) e o
 * utilizador ainda não confirmou no dashboard (`interpret_confirmed` ≠ true).
 */
export function isOnboardingFiscalInterpretConfirmPhase(raw: unknown): boolean {
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  if (!o) return false;
  if (!syncFlagIsExplicitOff(o.sync)) return false;
  if (o.interpret_confirmed === true) return false;
  return true;
}

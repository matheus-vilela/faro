function syncFlagIsExplicitOff(v: unknown): boolean {
  return v === false || v === "false" || v === 0 || v === "0";
}

function syncFlagIsOn(v: unknown): boolean {
  if (v === true || v === "true" || v === 1 || v === "1") return true;
  if (syncFlagIsExplicitOff(v)) return false;
  return typeof v === "string" ? v.trim().toLowerCase() === "true" : false;
}

/**
 * Card de NF-e / onboarding fiscal no dashboard só é permitido com `sync` ativo
 * (ou chave `sync` ausente = alinhado ao default jsonb na criação da empresa).
 * Com `sync` explicitamente falso (`false`, `"false"`, `0`…) o card não deve aparecer.
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

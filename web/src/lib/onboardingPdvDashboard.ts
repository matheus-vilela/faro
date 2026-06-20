import {
  isOnboardingPdvJsonCompleted,
  onboardingPdvSalesProgressPercent,
  parseOnboardingPdvSalesMetrics,
  type OnboardingPdvImportStatus,
} from "@/lib/onboardingPdvDefaults";

export type ParsedOnboardingPdv = {
  completed: boolean;
  sync: boolean;
  portal_busy: boolean;
  portal_outcome: string | null;
  portal_message: string | null;
  import_status: OnboardingPdvImportStatus | null;
  import_error: string | null;
  sales_total: number;
  sales_sync: number;
};

function onboardingPdvObject(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

const IMPORT_STATUSES = new Set([
  "pending",
  "processing",
  "completed",
  "failed",
]);

function parseImportStatus(v: unknown): OnboardingPdvImportStatus | null {
  if (typeof v !== "string" || !IMPORT_STATUSES.has(v)) return null;
  return v as OnboardingPdvImportStatus;
}

export function parseOnboardingPdv(raw: unknown): ParsedOnboardingPdv {
  const o = onboardingPdvObject(raw);
  const sales = parseOnboardingPdvSalesMetrics(raw);
  const portalOutcome =
    typeof o?.portal_outcome === "string" && o.portal_outcome.trim()
      ? o.portal_outcome.trim()
      : null;
  const portalMessage =
    typeof o?.portal_message === "string" && o.portal_message.trim()
      ? o.portal_message.trim()
      : null;
  const importError =
    typeof o?.import_error === "string" && o.import_error.trim()
      ? o.import_error.trim()
      : null;
  return {
    completed: o?.completed === true,
    sync: o?.sync === true,
    portal_busy: o?.portal_busy === true,
    portal_outcome: portalOutcome,
    portal_message: portalMessage,
    import_status: parseImportStatus(o?.import_status),
    import_error: importError,
    sales_total: sales.sales_total,
    sales_sync: sales.sales_sync,
  };
}

/**
 * Import concluído (`import_status === completed` e todas as linhas processadas).
 * Utilizador confirma no dashboard.
 */
export function isOnboardingPdvConfirmPhase(raw: unknown): boolean {
  const o = parseOnboardingPdv(raw);
  if (o.completed) return false;
  if (o.import_status !== "completed") return false;
  if (o.sales_total <= 0) return false;
  return o.sales_sync >= o.sales_total;
}

export function isOnboardingPdvPortalFailure(raw: unknown): boolean {
  const o = parseOnboardingPdv(raw);
  if (o.portal_busy) return false;
  return (
    o.portal_outcome === "no_tbl_export" || o.portal_outcome === "failed"
  );
}

export function isOnboardingPdvImportActive(raw: unknown): boolean {
  const o = parseOnboardingPdv(raw);
  return (
    o.import_status === "pending" || o.import_status === "processing"
  );
}

/** Import de vendas em curso (ainda não na fase de confirmação). */
export function isOnboardingPdvProcessingSales(raw: unknown): boolean {
  const o = parseOnboardingPdv(raw);
  if (o.completed || isOnboardingPdvConfirmPhase(raw)) return false;
  return (
    isOnboardingPdvImportActive(raw) ||
    o.sales_sync > 0 ||
    (o.sales_total > 0 && o.sales_sync < o.sales_total)
  );
}

/** `sync` ativo mas ainda sem dados do CSV — portal ainda não sincronizou. */
export function isOnboardingPdvAwaitingEpocSync(raw: unknown): boolean {
  const o = parseOnboardingPdv(raw);
  if (o.completed || !o.sync) return false;
  if (o.sales_total > 0 || o.sales_sync > 0) return false;
  if (o.portal_busy) return false;
  if (isOnboardingPdvImportActive(raw)) return false;
  return true;
}

export function onboardingPdvDashboardProgressPercent(
  raw: unknown,
): number {
  const o = parseOnboardingPdv(raw);
  if (isOnboardingPdvConfirmPhase(raw)) return 100;
  if (o.import_status === "failed") return 0;
  if (o.portal_busy && !isOnboardingPdvImportActive(raw)) return 18;
  if (o.sales_total > 0 || o.sales_sync > 0) {
    if (o.sales_total > 0) {
      return onboardingPdvSalesProgressPercent({
        sales_total: o.sales_total,
        sales_sync: o.sales_sync,
      });
    }
    return 8;
  }
  if (o.import_status === "pending") return 8;
  if (isOnboardingPdvAwaitingEpocSync(raw) || o.portal_busy) return 18;
  return 0;
}

export { isOnboardingPdvJsonCompleted };

export type OnboardingPdvImportStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

/** Valores iniciais de `companies.onboarding_pdv` (alinhado às migrations). */
export const DEFAULT_ONBOARDING_PDV = {
  completed: false,
  sync: false,
  sales_total: 0,
  sales_sync: 0,
  portal_busy: false,
  portal_outcome: null,
  portal_message: null,
  import_status: null,
  import_error: null,
} as const;

export type OnboardingPdvSalesMetrics = {
  sales_total: number;
  sales_sync: number;
};

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
  patch: Partial<{
    completed: boolean;
    sync: boolean;
    sales_total: number;
    sales_sync: number;
    portal_busy: boolean;
    portal_outcome: string | null;
    portal_message: string | null;
    import_status: OnboardingPdvImportStatus | null;
    import_error: string | null;
  }>,
): Record<string, unknown> {
  const prev = onboardingPdvObject(raw) ?? {};
  return { ...prev, ...patch };
}

function pdvMetric(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0;
}

/** Progresso do import CSV no onboarding (`sales_sync` / `sales_total`). */
export function parseOnboardingPdvSalesMetrics(
  raw: unknown,
): OnboardingPdvSalesMetrics {
  const o = onboardingPdvObject(raw);
  return {
    sales_total: pdvMetric(o?.sales_total),
    sales_sync: pdvMetric(o?.sales_sync),
  };
}

export function onboardingPdvSalesProgressPercent(
  metrics: OnboardingPdvSalesMetrics,
): number {
  const { sales_total, sales_sync } = metrics;
  if (sales_total <= 0) return 0;
  return Math.min(100, Math.round((sales_sync / sales_total) * 100));
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

/** Import CSV de vendas ainda não terminou (fila, chunks ou linhas em falta). */
export function isOnboardingPdvImportInProgress(raw: unknown): boolean {
  const o = onboardingPdvObject(raw);
  const st = o?.import_status;
  if (st === "pending" || st === "processing") return true;
  const { sales_total, sales_sync } = parseOnboardingPdvSalesMetrics(raw);
  return sales_total > 0 && sales_sync < sales_total;
}

/** Não limpar `sync` enquanto o import de vendas do onboarding estiver ativo. */
export function shouldKeepOnboardingPdvSync(raw: unknown): boolean {
  return isOnboardingPdvImportInProgress(raw);
}

/** Fluxo de onboarding PDV já iniciado (métricas/portal/import/sync). */
export function isOnboardingPdvFlowEngaged(raw: unknown): boolean {
  const o = onboardingPdvObject(raw);
  if (!o) return false;
  if (o.sync === true) return true;
  if (o.portal_busy === true) return true;
  if (o.portal_outcome != null && String(o.portal_outcome).trim() !== "") {
    return true;
  }
  const st = o.import_status;
  if (st === "pending" || st === "processing" || st === "failed") {
    return true;
  }
  const { sales_total, sales_sync } = parseOnboardingPdvSalesMetrics(raw);
  return sales_total > 0 || sales_sync > 0;
}

/**
 * Card de onboarding EPOC no dashboard: etapa PDV em aberto e fluxo já iniciado
 * (evita card por `completed: false` sem nunca ter entrado no onboarding).
 */
export function isOnboardingPdvDashboardCardVisible(raw: unknown): boolean {
  if (isOnboardingPdvJsonCompleted(raw)) return false;
  return isOnboardingPdvFlowEngaged(raw);
}

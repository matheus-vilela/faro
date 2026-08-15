export function intFromEnv(
  name: string,
  defaultVal: number,
  min: number,
  max: number,
): number {
  const raw = Deno.env.get(name)?.trim();
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return defaultVal;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function focusApiBase(): string {
  return (
    Deno.env.get("FOCUS_NFE_API_BASE")?.trim() || "https://api.focusnfe.com.br"
  ).replace(/\/$/, "");
}

export function focusToken(): string | null {
  const t = Deno.env.get("FOCUS_NFE_TOKEN")?.trim();
  return t || null;
}

export const NFE_XML_BUCKET = "nfe-xml";

export function steadyIntervalMinutes(): number {
  return intFromEnv("NFE_STEADY_INTERVAL_MINUTES", 120, 15, 24 * 60);
}

export function onboardingEmptyPollMinutes(): number {
  return intFromEnv("NFE_ONBOARDING_EMPTY_POLL_MINUTES", 20, 5, 24 * 60);
}

export function dispatcherCompaniesPerTick(): number {
  return intFromEnv("NFE_DISPATCH_COMPANIES_PER_TICK", 15, 1, 100);
}

export function workerJobsPerTick(): number {
  return intFromEnv("NFE_WORKER_JOBS_PER_TICK", 8, 1, 50);
}

/** Teto dos GETs automáticos Focus (lista/XML). Máx. 80; 20 ficam para manuais. */
export function focusAutoMaxPerMinute(): number {
  return intFromEnv("FOCUS_AUTO_MAX_PER_MINUTE", 80, 10, 80);
}

export function workerBudgetMs(): number {
  return intFromEnv("NFE_WORKER_BUDGET_MS", 70_000, 10_000, 140_000);
}

export function leaseSeconds(): number {
  return intFromEnv("NFE_JOB_LEASE_SECONDS", 180, 30, 600);
}

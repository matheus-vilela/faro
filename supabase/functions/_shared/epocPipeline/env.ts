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

/** Empty poll no onboarding quando o portal não devolve vendas. */
export function onboardingEmptyPollMinutes(): number {
  return intFromEnv("EPOC_ONBOARDING_EMPTY_POLL_MINUTES", 60, 15, 24 * 60);
}

/** Backoff após falha técnica do portal. */
export function backoffMinutes(): number {
  return intFromEnv("EPOC_BACKOFF_MINUTES", 12 * 60, 15, 48 * 60);
}

export function dispatcherCompaniesPerTick(): number {
  return intFromEnv("EPOC_DISPATCH_COMPANIES_PER_TICK", 5, 1, 50);
}

export function workerJobsPerTick(): number {
  return intFromEnv("EPOC_WORKER_JOBS_PER_TICK", 2, 1, 20);
}

/** Portal + CSV pode demorar; budget alto por tick. */
export function workerBudgetMs(): number {
  return intFromEnv("EPOC_WORKER_BUDGET_MS", 120_000, 30_000, 140_000);
}

export function leaseSeconds(): number {
  return intFromEnv("EPOC_JOB_LEASE_SECONDS", 300, 60, 900);
}

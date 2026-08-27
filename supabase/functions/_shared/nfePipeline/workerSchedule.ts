/** Alinha o worker ao cron `* * * * *` (próximo minuto civil). */
export function msUntilNextMinute(nowMs: number = Date.now()): number {
  const rem = nowMs % 60_000;
  return rem === 0 ? 60_000 : 60_000 - rem;
}

export function workerShouldStopForNextTick(input: {
  alignToCron: boolean;
  stopBeforeMs: number;
  elapsedMs: number;
  budgetMs: number;
  nowMs?: number;
}): boolean {
  if (input.elapsedMs >= input.budgetMs) return true;
  if (input.alignToCron) {
    return msUntilNextMinute(input.nowMs) < input.stopBeforeMs;
  }
  return input.budgetMs - input.elapsedMs < 5_000;
}

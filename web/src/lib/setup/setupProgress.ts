import type { CompanySetupMap, SetupStepNumber } from "@/types/companySetup";

const TOTAL_STEPS = 4;

function asStep(n: number): SetupStepNumber | null {
  if (n >= 1 && n <= 4) return n as SetupStepNumber;
  return null;
}

/** Passos que contam como “feitos” para o percentual */
function isStepCounted(
  step: SetupStepNumber,
  setup: CompanySetupMap,
): boolean {
  const completed = new Set(setup.completed_steps ?? []);
  const skipped = new Set(setup.skipped_steps ?? []);
  return completed.has(step) || skipped.has(step);
}

/**
 * Progresso linear: 4 passos de igual peso.
 * Passos em `skipped_steps` (ex.: PDV/EPOC “não usa”) contam como concluídos.
 */
export function calculateSetupProgress(setup: CompanySetupMap): number {
  let count = 0;
  for (let s = 1; s <= TOTAL_STEPS; s++) {
    if (isStepCounted(s as SetupStepNumber, setup)) count += 1;
  }
  const pct = (count / TOTAL_STEPS) * 100;
  return Math.round(pct * 100) / 100;
}

/**
 * Próximo passo ainda não contado; se todos contados, retorna 5 (fluxo de finalização).
 */
export function getNextPendingStep(setup: CompanySetupMap): number {
  for (let s = 1; s <= TOTAL_STEPS; s++) {
    if (!isStepCounted(s as SetupStepNumber, setup)) return s;
  }
  return TOTAL_STEPS + 1;
}

export function mergeSetupPatch(
  base: CompanySetupMap,
  patch: Partial<CompanySetupMap>,
): CompanySetupMap {
  const next: CompanySetupMap = {
    ...base,
    ...patch,
    completed_steps: patch.completed_steps ?? base.completed_steps ?? [],
    skipped_steps: patch.skipped_steps ?? base.skipped_steps ?? [],
  };
  next.progress_percent = calculateSetupProgress(next);
  return next;
}

export function markStepCompleted(
  setup: CompanySetupMap,
  step: SetupStepNumber,
): CompanySetupMap {
  const completed = new Set(setup.completed_steps ?? []);
  completed.add(step);
  return mergeSetupPatch(setup, {
    completed_steps: [...completed].sort((a, b) => a - b),
  });
}

export function markStepSkipped(
  setup: CompanySetupMap,
  step: SetupStepNumber,
): CompanySetupMap {
  const skipped = new Set(setup.skipped_steps ?? []);
  skipped.add(step);
  return mergeSetupPatch(setup, {
    skipped_steps: [...skipped].sort((a, b) => a - b),
  });
}

export function stepStatus(
  step: SetupStepNumber,
  setup: CompanySetupMap,
  activeStep: number,
): "pending" | "current" | "done" | "skipped" {
  const skipped = new Set(setup.skipped_steps ?? []);
  const completed = new Set(setup.completed_steps ?? []);
  if (skipped.has(step)) return "skipped";
  if (completed.has(step)) return "done";
  if (step === activeStep) return "current";
  return "pending";
}

export { asStep, TOTAL_STEPS };

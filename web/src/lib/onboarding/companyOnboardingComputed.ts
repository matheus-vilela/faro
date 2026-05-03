/**
 * Espelha a regra do trigger `companies_recompute_onboarding_completed` (fonte de verdade no Postgres).
 */
export function computeOnboardingCompleted(params: {
  setupStatus: string | null | undefined;
  onboardingFiscalCompleted: boolean;
  onboardingIntegrationPdvCompleted: boolean;
}): boolean {
  const wizardDone = params.setupStatus === "completed";
  return (
    wizardDone &&
    params.onboardingFiscalCompleted &&
    params.onboardingIntegrationPdvCompleted
  );
}

/** Valores iniciais de `companies.onboarding_fiscal` (alinhado às migrations). */
export const DEFAULT_ONBOARDING_FISCAL = {
  sync: true,
  max_nfes_sync: 0,
  nfes_sync: 0,
  nfes_ignored: 0,
  completed: false,
  /** Fase 1 pipeline: XMLs da janela baixados. `completed` só na Fase 2 (motor). */
  capture_completed: false,
  sefaz_unavailable: false,
} as const;

export type OnboardingFiscalDefaults = typeof DEFAULT_ONBOARDING_FISCAL;

export function defaultOnboardingFiscalRecord(): Record<string, unknown> {
  return { ...DEFAULT_ONBOARDING_FISCAL };
}

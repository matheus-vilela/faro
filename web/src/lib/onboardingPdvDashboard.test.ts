import { describe, expect, it } from "vitest";
import {
  ONBOARDING_PDV_RESUME_STALLED_PROGRESS_DELAY_MS,
  shouldShowOnboardingPdvResumeImportButton,
} from "./onboardingPdvDashboard";

describe("shouldShowOnboardingPdvResumeImportButton", () => {
  it("mostra retomar quando o progresso parcial travou", () => {
    const started = new Date(
      Date.now() - ONBOARDING_PDV_RESUME_STALLED_PROGRESS_DELAY_MS - 1000,
    ).toISOString();
    const raw = {
      completed: false,
      sync: true,
      import_status: "processing",
      sales_total: 1431,
      sales_sync: 20,
      import_started_at: started,
    };
    expect(shouldShowOnboardingPdvResumeImportButton(raw)).toBe(true);
  });

  it("não mostra retomar logo no início do progresso parcial", () => {
    const raw = {
      completed: false,
      sync: true,
      import_status: "processing",
      sales_total: 1431,
      sales_sync: 20,
      import_started_at: new Date().toISOString(),
    };
    expect(shouldShowOnboardingPdvResumeImportButton(raw)).toBe(false);
  });
});

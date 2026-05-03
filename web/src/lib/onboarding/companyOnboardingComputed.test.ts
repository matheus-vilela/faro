import { describe, expect, it } from "vitest";
import { computeOnboardingCompleted } from "./companyOnboardingComputed";

describe("computeOnboardingCompleted", () => {
  it("é false se o assistente não está completed", () => {
    expect(
      computeOnboardingCompleted({
        setupStatus: "in_progress",
        onboardingFiscalCompleted: true,
        onboardingIntegrationPdvCompleted: true,
      }),
    ).toBe(false);
  });

  it("é false se falta fiscal", () => {
    expect(
      computeOnboardingCompleted({
        setupStatus: "completed",
        onboardingFiscalCompleted: false,
        onboardingIntegrationPdvCompleted: true,
      }),
    ).toBe(false);
  });

  it("é false se falta integração PDV", () => {
    expect(
      computeOnboardingCompleted({
        setupStatus: "completed",
        onboardingFiscalCompleted: true,
        onboardingIntegrationPdvCompleted: false,
      }),
    ).toBe(false);
  });

  it("é true quando as três condições se verificam", () => {
    expect(
      computeOnboardingCompleted({
        setupStatus: "completed",
        onboardingFiscalCompleted: true,
        onboardingIntegrationPdvCompleted: true,
      }),
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { computeOnboardingCompleted } from "./companyOnboardingComputed";

describe("computeOnboardingCompleted", () => {
  it("true quando wizard, fiscal JSON e PDV concluídos", () => {
    expect(
      computeOnboardingCompleted({
        setupStatus: "completed",
        onboardingFiscal: { completed: true },
        onboardingIntegrationPdvCompleted: true,
      }),
    ).toBe(true);
  });

  it("false quando fiscal JSON incompleto", () => {
    expect(
      computeOnboardingCompleted({
        setupStatus: "completed",
        onboardingFiscal: { completed: false },
        onboardingIntegrationPdvCompleted: true,
      }),
    ).toBe(false);
  });

  it("false quando wizard incompleto", () => {
    expect(
      computeOnboardingCompleted({
        setupStatus: "in_progress",
        onboardingFiscal: { completed: true },
        onboardingIntegrationPdvCompleted: true,
      }),
    ).toBe(false);
  });

  it("false quando PDV incompleto", () => {
    expect(
      computeOnboardingCompleted({
        setupStatus: "completed",
        onboardingFiscal: { completed: true },
        onboardingIntegrationPdvCompleted: false,
      }),
    ).toBe(false);
  });
});

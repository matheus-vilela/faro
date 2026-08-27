import { describe, expect, it } from "vitest";
import {
  isOnboardingFiscalDashboardCardVisible,
  isOnboardingFiscalInterpretConfirmPhase,
  isOnboardingFiscalSearchingNotes,
  onboardingFiscalFoundNotesLabel,
  onboardingFiscalProcessedNotesLabel,
} from "./onboardingFiscalDashboard";

describe("isOnboardingFiscalSearchingNotes", () => {
  it("está a buscar enquanto a listagem não esgotou", () => {
    expect(
      isOnboardingFiscalSearchingNotes({
        sync: true,
        completed: false,
        capture_completed: false,
        max_nfes_sync: 50,
      }),
    ).toBe(true);
  });

  it("termina a busca quando list_exhausted", () => {
    expect(
      isOnboardingFiscalSearchingNotes({
        sync: true,
        completed: false,
        capture_completed: false,
        list_exhausted: true,
        max_nfes_sync: 120,
      }),
    ).toBe(false);
  });

  it("não busca se a captura ou o onboarding já fecharam", () => {
    expect(
      isOnboardingFiscalSearchingNotes({
        list_exhausted: false,
        capture_completed: true,
      }),
    ).toBe(false);
    expect(
      isOnboardingFiscalSearchingNotes({
        list_exhausted: false,
        completed: true,
      }),
    ).toBe(false);
  });
});

describe("isOnboardingFiscalInterpretConfirmPhase", () => {
  it("mostra Concluir quando a captura fechou e o utilizador ainda não confirmou", () => {
    expect(
      isOnboardingFiscalInterpretConfirmPhase({
        capture_completed: true,
        completed: false,
        sync: false,
      }),
    ).toBe(true);
  });

  it("não mostra Concluir se o onboarding já foi fechado", () => {
    expect(
      isOnboardingFiscalInterpretConfirmPhase({
        capture_completed: true,
        completed: true,
      }),
    ).toBe(false);
  });
});

describe("isOnboardingFiscalDashboardCardVisible", () => {
  it("mantém o card após a captura até o utilizador concluir", () => {
    expect(
      isOnboardingFiscalDashboardCardVisible({
        capture_completed: true,
        completed: false,
        sync: false,
      }),
    ).toBe(true);
  });

  it("esconde o card só depois de completed", () => {
    expect(
      isOnboardingFiscalDashboardCardVisible({
        capture_completed: true,
        completed: true,
      }),
    ).toBe(false);
  });
});

describe("onboardingFiscalFoundNotesLabel", () => {
  it("usa singular e plural", () => {
    expect(onboardingFiscalFoundNotesLabel(0)).toBe(
      "0 notas fiscais encontradas",
    );
    expect(onboardingFiscalFoundNotesLabel(1)).toBe("1 nota fiscal encontrada");
    expect(onboardingFiscalFoundNotesLabel(48)).toBe(
      "48 notas fiscais encontradas",
    );
  });
});

describe("onboardingFiscalProcessedNotesLabel", () => {
  it("mostra processadas / total", () => {
    expect(onboardingFiscalProcessedNotesLabel(0, 120)).toBe(
      "0 / 120 notas processadas, interpretadas",
    );
    expect(onboardingFiscalProcessedNotesLabel(61, 120)).toBe(
      "61 / 120 notas processadas, interpretadas",
    );
  });
});

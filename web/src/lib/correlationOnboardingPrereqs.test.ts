import { describe, expect, it } from "vitest";
import {
  correlationFiscalStepStatus,
  correlationOnboardingCanStart,
  correlationPdvStepStatus,
} from "./correlationOnboardingPrereqs";

describe("correlationFiscalStepStatus", () => {
  it("sucesso quando completed", () => {
    expect(
      correlationFiscalStepStatus({ completed: true, capture_completed: true }),
    ).toBe("success");
  });

  it("alerta quando a SEFAZ está indisponível", () => {
    expect(
      correlationFiscalStepStatus({
        completed: false,
        sefaz_unavailable: true,
      }),
    ).toBe("alert");
  });

  it("alerta quando falta o Concluir no dashboard", () => {
    expect(
      correlationFiscalStepStatus({
        completed: false,
        capture_completed: true,
        sync: false,
      }),
    ).toBe("alert");
  });

  it("processando enquanto busca ou interpreta notas", () => {
    expect(
      correlationFiscalStepStatus({
        completed: false,
        capture_completed: false,
        sync: true,
      }),
    ).toBe("processing");
  });
});

describe("correlationPdvStepStatus", () => {
  it("sucesso quando completed", () => {
    expect(correlationPdvStepStatus({ completed: true })).toBe("success");
  });

  it("erro quando o import falhou", () => {
    expect(
      correlationPdvStepStatus({
        completed: false,
        import_status: "failed",
      }),
    ).toBe("error");
  });

  it("erro quando o portal falhou", () => {
    expect(
      correlationPdvStepStatus({
        completed: false,
        portal_busy: false,
        portal_outcome: "failed",
      }),
    ).toBe("error");
  });

  it("alerta quando falta confirmar no dashboard", () => {
    expect(
      correlationPdvStepStatus({
        completed: false,
        import_status: "completed",
        sales_total: 10,
        sales_sync: 10,
      }),
    ).toBe("alert");
  });

  it("processando durante o import", () => {
    expect(
      correlationPdvStepStatus({
        completed: false,
        sync: true,
        import_status: "processing",
        sales_total: 100,
        sales_sync: 20,
      }),
    ).toBe("processing");
  });
});

describe("correlationOnboardingCanStart", () => {
  it("só libera com fiscal e PDV concluídos", () => {
    expect(
      correlationOnboardingCanStart(
        { completed: true },
        { completed: false, sync: true },
      ),
    ).toBe(false);
    expect(
      correlationOnboardingCanStart({ completed: true }, { completed: true }),
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { importFileLogStatusLabel, importJobStatusLabel } from "./importBatchStatus";

describe("importJobStatusLabel", () => {
  it("traduz status de lote conhecidos", () => {
    expect(importJobStatusLabel("CANCELLED")).toBe("Cancelado");
    expect(importJobStatusLabel("PROCESSING")).toBe("Processando");
    expect(importJobStatusLabel("COMPLETED_WITH_PENDING_REVIEW")).toBe(
      "Concluído com revisões pendentes",
    );
  });
});

describe("importFileLogStatusLabel", () => {
  it("traduz status do log do ZIP", () => {
    expect(importFileLogStatusLabel("cancelled")).toBe("Cancelado");
    expect(importFileLogStatusLabel("needs_review")).toBe("Revisão pendente");
  });
});

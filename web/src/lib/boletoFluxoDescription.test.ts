import { describe, expect, it } from "vitest";
import {
  boletoCounterpartyLabel,
  boletoReconSecondaryLabel,
  boletoReconTitle,
} from "./boletoFluxoDescription";

describe("boletoRecon labels", () => {
  it("prioriza fornecedor no título e NF no secundário", () => {
    const b = {
      description: "NF 150088 série 1 — dup. 1",
      provider: "Distribuidora XYZ",
      supplier: null,
    };
    expect(boletoCounterpartyLabel(b)).toBe("Distribuidora XYZ");
    expect(boletoReconTitle(b)).toBe("Distribuidora XYZ");
    expect(boletoReconSecondaryLabel(b)).toBe("NF 150088 série 1 — dup. 1");
  });

  it("usa nome do supplier quando presente", () => {
    const b = {
      description: "NF 1 série 1 — dup. 1",
      provider: "Nome antigo",
      supplier: { name: "Fornecedor Oficial" },
    };
    expect(boletoReconTitle(b)).toBe("Fornecedor Oficial");
  });

  it("cai na descrição quando não há fornecedor", () => {
    const b = {
      description: "NF 32998 série 1 — dup. 1",
      provider: null,
    };
    expect(boletoReconTitle(b)).toBe("NF 32998 série 1 — dup. 1");
    expect(boletoReconSecondaryLabel(b)).toBeNull();
  });
});

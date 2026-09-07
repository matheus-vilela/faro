import { describe, expect, it } from "vitest";
import { validateStep1Empresa } from "./validation";

const base = {
  nome_razao_social: "Eulalia Casa de Samba",
  nome_fantasia: "Eulalia Casa de Samba",
  regime_tributario: 1 as const,
};

describe("validateStep1Empresa CNPJ", () => {
  it("rejects 14 digits with invalid check digits", () => {
    expect(
      validateStep1Empresa({ ...base, cnpj_cpf: "47774895000188" }),
    ).toBe("CNPJ inválido. Confira os dígitos.");
  });

  it("accepts the same root with valid check digits", () => {
    expect(
      validateStep1Empresa({ ...base, cnpj_cpf: "47.774.895/0001-85" }),
    ).toBeNull();
  });
});

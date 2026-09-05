import { describe, expect, it } from "vitest";
import {
  applyFocusCnpjToSupplier,
  documentDigitsFromQuery,
} from "@/lib/applyFocusCnpjToSupplier";

describe("applyFocusCnpjToSupplier", () => {
  it("preenche razão social e CNPJ", () => {
    const result = applyFocusCnpjToSupplier({
      razao_social: "  Ambev S.A.  ",
      cnpj: "07.526.557/0105-04",
    });
    expect(result).toEqual({
      name: "Ambev S.A.",
      document: "07526557010504",
      email: undefined,
      phone: undefined,
    });
  });

  it("usa nome fantasia quando não há razão social", () => {
    const result = applyFocusCnpjToSupplier({
      cnpj: "07526557010504",
      nome_fantasia: "Ambev",
    });
    expect(result?.name).toBe("Ambev");
  });

  it("preenche e-mail e telefone extras da API", () => {
    const result = applyFocusCnpjToSupplier({
      razao_social: "Fornecedor LTDA",
      cnpj: "07526557010504",
      email: "contato@fornecedor.com",
      telefone: "(11) 3333-4444",
    });
    expect(result?.email).toBe("contato@fornecedor.com");
    expect(result?.phone).toBe("1133334444");
  });

  it("retorna null sem nome ou CNPJ completo", () => {
    expect(applyFocusCnpjToSupplier({ cnpj: "07526557010504" })).toBeNull();
    expect(
      applyFocusCnpjToSupplier({ razao_social: "X", cnpj: "123" }),
    ).toBeNull();
  });
});

describe("documentDigitsFromQuery", () => {
  it("extrai CNPJ ou CPF da busca", () => {
    expect(documentDigitsFromQuery("07526557010504")).toBe("07526557010504");
    expect(documentDigitsFromQuery("07.526.557/0105-04")).toBe("07526557010504");
    expect(documentDigitsFromQuery("123.456.789-00")).toBe("12345678900");
    expect(documentDigitsFromQuery("Ambev")).toBe("");
    expect(documentDigitsFromQuery("12345")).toBe("");
  });
});

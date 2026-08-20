import { describe, expect, it } from "vitest";
import {
  isUsableBankDescriptionKey,
  normalizeBankDescription,
} from "./normalizeBankDescription";

describe("normalizeBankDescription", () => {
  it("remove acentos, números longos e pontuação", () => {
    expect(
      normalizeBankDescription("PIX RECEBIDO REND PAGO APLIC 83920184721"),
    ).toBe("PIX RECEBIDO REND PAGO APLIC");
    expect(normalizeBankDescription("Valor de Rendimento")).toBe(
      "VALOR DE RENDIMENTO",
    );
  });

  it("colapsa espaços e ignora IDs de PIX", () => {
    expect(
      normalizeBankDescription("  pix enviado para claro s.a. 12345678901  "),
    ).toBe("PIX ENVIADO PARA CLARO S A");
  });

  it("rejeita chaves curtas demais", () => {
    expect(isUsableBankDescriptionKey("TED")).toBe(false);
    expect(isUsableBankDescriptionKey("REND PAGO APLIC")).toBe(true);
  });
});

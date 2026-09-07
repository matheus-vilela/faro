import { describe, expect, it } from "vitest";
import { messageFromConsultaCnpjFailure } from "./focusConsultaCnpjService";

describe("messageFromConsultaCnpjFailure", () => {
  it("usa error da edge", () => {
    expect(
      messageFromConsultaCnpjFailure({ ok: false, error: "Token ausente." }, 502),
    ).toBe("Token ausente.");
  });

  it("usa mensagem da Focus quando a edge só espelha o 403", () => {
    expect(
      messageFromConsultaCnpjFailure(
        {
          ok: false,
          status: 403,
          focus: { codigo: "permissao_negada", mensagem: "Aplicação bloqueada." },
        },
        403,
      ),
    ).toBe("Aplicação bloqueada.");
  });

  it("explica 403 genérico", () => {
    expect(messageFromConsultaCnpjFailure({ ok: false }, 403)).toMatch(
      /Focus recusou/,
    );
  });
});

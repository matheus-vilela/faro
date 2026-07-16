import { describe, expect, it } from "vitest";
import { humanizeAuthError } from "./authErrorMessage";

describe("humanizeAuthError", () => {
  it("traduz e-mail não confirmado", () => {
    expect(
      humanizeAuthError({ code: "email_not_confirmed", message: "Email not confirmed" }),
    ).toContain("Confirme seu e-mail");
  });

  it("traduz credenciais inválidas", () => {
    expect(
      humanizeAuthError({ message: "Invalid login credentials" }, "login"),
    ).toBe("E-mail ou senha incorretos.");
  });

  it("traduz falha de rede", () => {
    expect(humanizeAuthError({ message: "Failed to fetch" }, "login")).toContain(
      "conexão",
    );
  });

  it("usa fallback por contexto", () => {
    expect(humanizeAuthError({ message: "Unknown xyz" }, "signup")).toBe(
      "Não foi possível criar a conta. Tente novamente.",
    );
  });
});

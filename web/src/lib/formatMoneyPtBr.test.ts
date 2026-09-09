import { describe, expect, it } from "vitest";
import { parseMoneyPtBr } from "./formatMoneyPtBr";

describe("parseMoneyPtBr", () => {
  it("lê formato brasileiro com milhar e decimal", () => {
    expect(parseMoneyPtBr("20.213,88")).toBe(20213.88);
    expect(parseMoneyPtBr("20.000,00")).toBe(20000);
    expect(parseMoneyPtBr("20.000")).toBe(20000);
    expect(parseMoneyPtBr("20213,88")).toBe(20213.88);
  });

  it("não infla valor já normalizado (ponto decimal)", () => {
    expect(parseMoneyPtBr("20213.88")).toBe(20213.88);
  });

  it("aceita prefixo R$ e espaços", () => {
    expect(parseMoneyPtBr("R$ 20.213,88")).toBe(20213.88);
    expect(parseMoneyPtBr("R$20.213,88")).toBe(20213.88);
  });

  it("lê zero e vazio", () => {
    expect(parseMoneyPtBr("0,00")).toBe(0);
    expect(parseMoneyPtBr("")).toBe(null);
    expect(parseMoneyPtBr("   ")).toBe(null);
    expect(parseMoneyPtBr(null)).toBe(null);
  });

  it("rejeita texto sem dígitos", () => {
    expect(parseMoneyPtBr("abc")).toBe(null);
  });
});

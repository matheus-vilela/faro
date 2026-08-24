import { describe, expect, it } from "vitest";
import {
  computePaidAmount,
  isValidPartialPayAmount,
  remainderAmount,
  roundMoney,
} from "./boletoPayment";

describe("remainderAmount", () => {
  it("calcula o saldo após um pagamento parcial", () => {
    expect(remainderAmount(100, 40)).toBe(60);
    expect(remainderAmount(100.1, 40.05)).toBe(60.05);
  });

  it("arredonda em centavos", () => {
    expect(remainderAmount(10.1, 3.33)).toBe(6.77);
    expect(remainderAmount(99.99, 33.33)).toBe(66.66);
  });
});

describe("isValidPartialPayAmount", () => {
  it("aceita valor estritamente entre zero e o total", () => {
    expect(isValidPartialPayAmount(100, 0.01)).toBe(true);
    expect(isValidPartialPayAmount(100, 99.99)).toBe(true);
    expect(isValidPartialPayAmount(100, 40)).toBe(true);
  });

  it("rejeita zero, total e valores inválidos", () => {
    expect(isValidPartialPayAmount(100, 0)).toBe(false);
    expect(isValidPartialPayAmount(100, 100)).toBe(false);
    expect(isValidPartialPayAmount(100, 150)).toBe(false);
    expect(isValidPartialPayAmount(100, -10)).toBe(false);
  });
});

describe("computePaidAmount com parcial", () => {
  it("aplica juros e desconto só sobre a parte paga", () => {
    expect(computePaidAmount(40, 2, 1)).toBe(41);
    expect(roundMoney(40.555)).toBe(40.56);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildMatchResult,
  buildMatchResultByDirection,
  dayDiffAbs,
  isStrongDateMatch,
  scoreProximity,
} from "./matchBankLines";

describe("matchBankLines", () => {
  it("match forte: mesmo dia e mesmo valor", () => {
    expect(isStrongDateMatch("2026-07-08", "2026-07-08")).toBe(true);
    const result = buildMatchResult(
      [
        {
          id: "l1",
          postedAt: "2026-07-08",
          amount: 3500,
          description: "TED IMOBILIARIA",
        },
      ],
      [
        {
          id: "b1",
          description: "Aluguel",
          amount: 3500,
          referenceDate: "2026-07-08",
          status: "pending",
        },
      ],
    );
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].kind).toBe("forte");
    expect(result.pairs[0].confidence).toBe(100);
    expect(result.sobancoLineIds).toHaveLength(0);
    expect(result.sofaroBoletoIds).toHaveLength(0);
  });

  it("match forte com vencimento em fim de semana (+2 dias)", () => {
    // sábado 11/07/2026 → pagamento segunda 13/07
    expect(isStrongDateMatch("2026-07-11", "2026-07-13")).toBe(true);
    expect(isStrongDateMatch("2026-07-10", "2026-07-13")).toBe(false);

    const result = buildMatchResult(
      [
        {
          id: "l1",
          postedAt: "2026-07-13",
          amount: 450,
          description: "DEB ENEL",
        },
      ],
      [
        {
          id: "b1",
          description: "Energia",
          amount: 450,
          referenceDate: "2026-07-11",
          status: "pending",
        },
      ],
    );
    expect(result.pairs[0]?.kind).toBe("forte");
  });

  it("match provável com juros pequeno", () => {
    const result = buildMatchResult(
      [
        {
          id: "l1",
          postedAt: "2026-07-05",
          amount: 458,
          description: "DEB AUTOM ENEL",
        },
      ],
      [
        {
          id: "b1",
          description: "Energia elétrica",
          amount: 450,
          referenceDate: "2026-07-05",
          status: "pending",
        },
      ],
    );
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].kind).toBe("provavel");
    expect(result.pairs[0].amountDiff).toBe(8);
    expect(result.pairs[0].suggestedInterest).toBe(8);
    expect(result.pairs[0].confidence).toBeGreaterThan(40);
  });

  it("classifica sobanco e sofaro", () => {
    const result = buildMatchResult(
      [
        {
          id: "l-taxa",
          postedAt: "2026-07-05",
          amount: 79,
          description: "TARIFA",
        },
      ],
      [
        {
          id: "b-abc",
          description: "Fornecedor ABC",
          amount: 1250,
          referenceDate: "2026-07-10",
          status: "pending",
        },
      ],
    );
    expect(result.pairs).toHaveLength(0);
    expect(result.sobancoLineIds).toEqual(["l-taxa"]);
    expect(result.sofaroBoletoIds).toEqual(["b-abc"]);
  });

  it("casa crédito do extrato com conta a receber quando chamado direto", () => {
    const result = buildMatchResult(
      [
        {
          id: "l-rend",
          postedAt: "2026-07-08",
          amount: 120.5,
          description: "VALOR DE RENDIMENTO",
        },
      ],
      [
        {
          id: "b-rend",
          description: "Rendimento CDB",
          amount: 120.5,
          referenceDate: "2026-07-08",
          status: "pending",
        },
      ],
    );
    expect(result.pairs[0]?.kind).toBe("forte");
    expect(result.pairs[0]?.boletoId).toBe("b-rend");
  });

  it("score sobe com proximidade", () => {
    expect(dayDiffAbs("2026-07-01", "2026-07-03")).toBe(2);
    expect(scoreProximity(0, 0, 100)).toBeGreaterThan(
      scoreProximity(3, 10, 100),
    );
  });

  it("conciliação por direção só casa débito com conta a pagar", () => {
    const result = buildMatchResultByDirection({
      debitLines: [
        {
          id: "l-deb",
          postedAt: "2026-07-08",
          amount: 100,
          description: "PIX CLARO",
        },
      ],
      creditLines: [
        {
          id: "l-cred",
          postedAt: "2026-07-08",
          amount: 100,
          description: "RENDIMENTO",
        },
      ],
      payables: [
        {
          id: "b-pagar",
          description: "Claro",
          amount: 100,
          referenceDate: "2026-07-08",
          status: "pending",
        },
      ],
      receivables: [
        {
          id: "b-receber",
          description: "Rendimento",
          amount: 100,
          referenceDate: "2026-07-08",
          status: "pending",
        },
      ],
    });
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]?.boletoId).toBe("b-pagar");
    expect(result.sobancoLineIds).toEqual([]);
  });
});

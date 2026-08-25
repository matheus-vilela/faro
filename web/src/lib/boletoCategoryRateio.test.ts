import { describe, expect, it } from "vitest";
import {
  amountFromPercent,
  filledPayableProductLines,
  initialRateioLines,
  percentOfTotal,
  primaryCategoryIdFromRateio,
  remainingToRateio,
  scaleRateioLines,
  validatePayableProductDraft,
  validateRateioDraft,
  type RateioDraftLine,
} from "./boletoCategoryRateio";

function line(
  partial: Partial<RateioDraftLine> & Pick<RateioDraftLine, "categoryId" | "amount">,
): RateioDraftLine {
  return { key: partial.key ?? partial.categoryId, ...partial };
}

describe("validateRateioDraft", () => {
  it("exige duas categorias e soma igual ao total", () => {
    expect(
      validateRateioDraft(
        [
          line({ categoryId: "energia", amount: 200 }),
          line({ categoryId: "internet", amount: 100 }),
        ],
        300,
      ),
    ).toEqual({ ok: true });
  });

  it("rejeita restante diferente de zero", () => {
    const result = validateRateioDraft(
      [
        line({ categoryId: "energia", amount: 200 }),
        line({ categoryId: "internet", amount: 50 }),
      ],
      300,
    );
    expect(result.ok).toBe(false);
  });

  it("rejeita categoria duplicada", () => {
    const result = validateRateioDraft(
      [
        line({ categoryId: "energia", amount: 150 }),
        line({ categoryId: "energia", amount: 150 }),
      ],
      300,
    );
    expect(result.ok).toBe(false);
  });
});

describe("primaryCategoryIdFromRateio", () => {
  it("usa a maior fatia e desempata pela ordem", () => {
    expect(
      primaryCategoryIdFromRateio([
        line({ categoryId: "a", amount: 100 }),
        line({ categoryId: "b", amount: 200 }),
      ]),
    ).toBe("b");
    expect(
      primaryCategoryIdFromRateio([
        line({ categoryId: "a", amount: 150 }),
        line({ categoryId: "b", amount: 150 }),
      ]),
    ).toBe("a");
  });
});

describe("scaleRateioLines", () => {
  it("redistribui o total e zera o restante", () => {
    const scaled = scaleRateioLines(
      [
        line({ categoryId: "energia", amount: 200 }),
        line({ categoryId: "internet", amount: 100 }),
      ],
      450,
    );
    expect(remainingToRateio(scaled, 450)).toBe(0);
    expect(scaled.map((l) => l.amount)).toEqual([300, 150]);
  });
});

describe("percent helpers", () => {
  it("converte valor e porcentagem", () => {
    expect(percentOfTotal(100, 300)).toBe(33.33);
    expect(amountFromPercent(50, 300)).toBe(150);
  });
});

describe("initialRateioLines", () => {
  it("começa com duas linhas", () => {
    expect(initialRateioLines("cat-1")).toHaveLength(2);
    expect(initialRateioLines("cat-1")[0]?.categoryId).toBe("cat-1");
  });
});

describe("payable product draft", () => {
  it("keeps only lines with product and quantity", () => {
    expect(
      filledPayableProductLines([
        {
          key: "a",
          productId: "p1",
          productName: "Arroz",
          quantity: 2,
          unitValue: 10,
        },
        {
          key: "b",
          productId: "",
          productName: "",
          quantity: 1,
          unitValue: 0,
        },
      ]),
    ).toHaveLength(1);
  });

  it("requires at least one linked product", () => {
    expect(
      validatePayableProductDraft([
        {
          key: "a",
          productId: "",
          productName: "",
          quantity: 1,
          unitValue: 0,
        },
      ]).ok,
    ).toBe(false);
    expect(
      validatePayableProductDraft([
        {
          key: "a",
          productId: "p1",
          productName: "Arroz",
          quantity: 1,
          unitValue: 8.5,
        },
      ]),
    ).toEqual({ ok: true });
  });
});

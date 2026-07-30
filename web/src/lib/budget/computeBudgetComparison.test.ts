import { describe, expect, it } from "vitest";
import {
  computeBudgetComparison,
  computeDeviationStatus,
  computePercentConsumed,
} from "./computeBudgetComparison";
import type { CompanyCategory } from "@/types/category";

function cat(
  partial: Partial<CompanyCategory> & Pick<CompanyCategory, "id" | "name">,
): CompanyCategory {
  return {
    company_id: "co-1",
    parent_id: null,
    sort_order: 0,
    ordem: 0,
    natureza: "DESPESA",
    tipo: "FIXA",
    papel_receita_dre: null,
    ativo: true,
    padrao_sistema: false,
    incluir_no_dre: true,
    ...partial,
  };
}

describe("computeDeviationStatus", () => {
  it("classifica ok, warning e over", () => {
    expect(computeDeviationStatus(1000, 800)).toBe("ok");
    expect(computeDeviationStatus(1000, 950)).toBe("warning");
    expect(computeDeviationStatus(1000, 1100)).toBe("over");
    expect(computeDeviationStatus(0, 100)).toBe("no_budget");
    expect(computeDeviationStatus(0, 0)).toBe("empty");
  });
});

describe("computePercentConsumed", () => {
  it("retorna null quando orçado é zero", () => {
    expect(computePercentConsumed(0, 500)).toBeNull();
    expect(computePercentConsumed(100, 50)).toBe(50);
  });
});

describe("computeBudgetComparison", () => {
  const categories: CompanyCategory[] = [
    cat({ id: "root-fixa", name: "Fixas", tipo: "FIXA" }),
    cat({
      id: "leaf-aluguel",
      name: "Aluguel",
      parent_id: "root-fixa",
      tipo: "FIXA",
    }),
    cat({
      id: "leaf-energia",
      name: "Energia",
      parent_id: "root-fixa",
      tipo: "FIXA",
    }),
    cat({ id: "root-cmv", name: "CMV", tipo: "CMV" }),
    cat({
      id: "leaf-insumos",
      name: "Insumos",
      parent_id: "root-cmv",
      tipo: "CMV",
    }),
  ];

  it("faz rollup pai/filho e calcula variação", () => {
    const result = computeBudgetComparison({
      categories,
      budgets: [
        { categoryId: "leaf-aluguel", amount: 5000 },
        { categoryId: "leaf-energia", amount: 800 },
        { categoryId: "leaf-insumos", amount: 3000 },
      ],
      actualByCategoryId: new Map([
        ["leaf-aluguel", 4800],
        ["leaf-energia", 950],
        ["leaf-insumos", 2800],
      ]),
    });

    expect(result.summary.totalBudgeted).toBe(8800);
    expect(result.summary.totalActual).toBe(8550);
    expect(result.summary.totalVariance).toBe(-250);

    const fixas = result.sections.find((s) => s.dreBucket === "DESPESAS_FIXAS");
    expect(fixas?.budgeted).toBe(5800);
    expect(fixas?.actual).toBe(5750);
    expect(fixas?.children[0]?.name).toBe("Fixas");
    expect(fixas?.children[0]?.budgeted).toBe(5800);
  });

  it("marca folha sem orçamento com realizado", () => {
    const result = computeBudgetComparison({
      categories,
      budgets: [],
      actualByCategoryId: new Map([["leaf-energia", 200]]),
    });

    const fixas = result.sections.find((s) => s.dreBucket === "DESPESAS_FIXAS");
    const energia = fixas?.children[0]?.children.find(
      (n) => n.id === "leaf-energia",
    );
    expect(energia?.status).toBe("no_budget");
  });

  it("ordena chartRows por maior desvio absoluto", () => {
    const result = computeBudgetComparison({
      categories,
      budgets: [
        { categoryId: "leaf-aluguel", amount: 1000 },
        { categoryId: "leaf-energia", amount: 1000 },
      ],
      actualByCategoryId: new Map([
        ["leaf-aluguel", 1000],
        ["leaf-energia", 1500],
      ]),
    });

    expect(result.chartRows[0]?.categoryId).toBe("leaf-energia");
    expect(Math.abs(result.chartRows[0]?.variance ?? 0)).toBe(500);
  });
});

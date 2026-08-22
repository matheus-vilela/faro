import { describe, expect, it } from "vitest";
import type { CompanyCategory } from "@/types/category";
import {
  allocateByWeights,
  boletoHasMultipleItemCategories,
  boletoHasUnclassifiedRemainder,
  expandBoletoAmountByItemCategories,
  expandBoletosToCategoryAmounts,
  groupRateioItemsByExpenseId,
  omitPurchaseCmvCategoryAmounts,
  resolvePrefillCompanyCategoryId,
  type RateioLine,
} from "./rateioBoletoByItems";

function dreCat(
  id: string,
  tipo: CompanyCategory["tipo"],
): CompanyCategory {
  return {
    id,
    company_id: "co-1",
    parent_id: null,
    name: id,
    sort_order: 0,
    created_at: "",
    updated_at: "",
    natureza: "DESPESA",
    tipo,
    ativo: true,
    incluir_no_dre: true,
  };
}

function item(
  partial: Partial<RateioLine> & Pick<RateioLine, "quantity" | "unit_value">,
): RateioLine {
  return {
    expense_id: "exp-1",
    company_category_id: null,
    ...partial,
  };
}

describe("resolvePrefillCompanyCategoryId", () => {
  it("prioriza a categoria já gravada na linha", () => {
    expect(
      resolvePrefillCompanyCategoryId({
        itemCategoryId: "item-cat",
        productDefaultCategoryId: "prod-cat",
      }),
    ).toBe("item-cat");
  });

  it("usa o default do produto quando a linha está vazia", () => {
    expect(
      resolvePrefillCompanyCategoryId({
        itemCategoryId: null,
        productDefaultCategoryId: "prod-cat",
        productCmvCategoryId: "cmv-cat",
      }),
    ).toBe("prod-cat");
  });

  it("cai na CMV do cadastro quando não há categoria de compra", () => {
    expect(
      resolvePrefillCompanyCategoryId({
        itemCategoryId: null,
        productDefaultCategoryId: null,
        productCmvCategoryId: "cmv-alimentos",
      }),
    ).toBe("cmv-alimentos");
  });
});

describe("allocateByWeights", () => {
  it("soma exatamente o total em centavos", () => {
    const parts = allocateByWeights(100, [1, 1, 1]);
    expect(parts.reduce((s, n) => s + n, 0)).toBeCloseTo(100, 10);
    expect(parts).toEqual([33.34, 33.33, 33.33]);
  });
});

describe("expandBoletoAmountByItemCategories", () => {
  it("sem nota usa a categoria da conta", () => {
    expect(
      expandBoletoAmountByItemCategories(
        { amount: 80, expense_id: null, company_category_id: "conta" },
        [],
      ),
    ).toEqual([{ amount: 80, company_category_id: "conta" }]);
  });

  it("nota sem itens com subtotal usa a categoria da conta", () => {
    expect(
      expandBoletoAmountByItemCategories(
        { amount: 50, expense_id: "exp-1", company_category_id: "conta" },
        [item({ quantity: 0, unit_value: 10 })],
      ),
    ).toEqual([{ amount: 50, company_category_id: "conta" }]);
  });

  it("rateia carne e detergente e o total iguala o boleto", () => {
    const rows = expandBoletoAmountByItemCategories(
      { amount: 100, expense_id: "exp-1", company_category_id: "conta" },
      [
        item({ quantity: 2, unit_value: 30, company_category_id: "carne" }),
        item({ quantity: 1, unit_value: 40, company_category_id: "limpeza" }),
      ],
    );
    const byCat = Object.fromEntries(
      rows.map((r) => [r.company_category_id, r.amount]),
    );
    expect(byCat.carne).toBe(60);
    expect(byCat.limpeza).toBe(40);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(100);
  });

  it("linha sem categoria herda a da conta", () => {
    const rows = expandBoletoAmountByItemCategories(
      { amount: 100, expense_id: "exp-1", company_category_id: "conta" },
      [
        item({ quantity: 1, unit_value: 70, company_category_id: "carne" }),
        item({ quantity: 1, unit_value: 30, company_category_id: null }),
      ],
    );
    const byCat = Object.fromEntries(
      rows.map((r) => [String(r.company_category_id), r.amount]),
    );
    expect(byCat.carne).toBe(70);
    expect(byCat.conta).toBe(30);
  });

  it("linhas todas classificadas ignoram a categoria da conta", () => {
    const rows = expandBoletoAmountByItemCategories(
      { amount: 90, expense_id: "exp-1", company_category_id: "conta" },
      [
        item({ quantity: 1, unit_value: 45, company_category_id: "a" }),
        item({ quantity: 1, unit_value: 45, company_category_id: "b" }),
      ],
    );
    expect(rows.map((r) => r.company_category_id).sort()).toEqual(["a", "b"]);
  });

  it("parcelas usam os mesmos pesos sobre o amount de cada boleto", () => {
    const items = [
      item({ quantity: 1, unit_value: 80, company_category_id: "a" }),
      item({ quantity: 1, unit_value: 20, company_category_id: "b" }),
    ];
    const byExpense = groupRateioItemsByExpenseId(items);
    const expanded = expandBoletosToCategoryAmounts(
      [
        { amount: 50, expense_id: "exp-1", company_category_id: "conta" },
        { amount: 50, expense_id: "exp-1", company_category_id: "conta" },
      ],
      byExpense,
    );
    const sumA = expanded
      .filter((r) => r.company_category_id === "a")
      .reduce((s, r) => s + r.amount, 0);
    const sumB = expanded
      .filter((r) => r.company_category_id === "b")
      .reduce((s, r) => s + r.amount, 0);
    expect(sumA).toBe(80);
    expect(sumB).toBe(20);
  });

  it("detecta resto sem categoria", () => {
    expect(
      boletoHasUnclassifiedRemainder(
        { amount: 10, expense_id: "exp-1", company_category_id: null },
        [item({ quantity: 1, unit_value: 10, company_category_id: null })],
      ),
    ).toBe(true);
    expect(
      boletoHasUnclassifiedRemainder(
        { amount: 10, expense_id: "exp-1", company_category_id: "conta" },
        [item({ quantity: 1, unit_value: 10, company_category_id: "a" })],
      ),
    ).toBe(false);
  });

  it("omite fatia CMV da compra e mantém limpeza no P&L", () => {
    const rows = expandBoletoAmountByItemCategories(
      { amount: 100, expense_id: "exp-1", company_category_id: "conta" },
      [
        item({ quantity: 2, unit_value: 30, company_category_id: "carne" }),
        item({ quantity: 1, unit_value: 40, company_category_id: "limpeza" }),
      ],
    );
    const dre = omitPurchaseCmvCategoryAmounts(
      rows,
      new Map([
        ["carne", dreCat("carne", "CMV")],
        ["limpeza", dreCat("limpeza", "VARIAVEL")],
      ]),
    );
    expect(dre).toEqual([{ amount: 40, company_category_id: "limpeza" }]);
    expect(dre.reduce((s, r) => s + r.amount, 0)).toBe(40);
  });

  it("NF só de alimento não entra no P&L da compra", () => {
    const rows = expandBoletoAmountByItemCategories(
      { amount: 80, expense_id: "exp-1", company_category_id: null },
      [item({ quantity: 1, unit_value: 80, company_category_id: "alimentos" })],
    );
    expect(
      omitPurchaseCmvCategoryAmounts(
        rows,
        new Map([["alimentos", dreCat("alimentos", "CMV")]]),
      ),
    ).toEqual([]);
  });

  it("detecta várias categorias nos itens", () => {
    expect(
      boletoHasMultipleItemCategories([
        item({ quantity: 1, unit_value: 1, company_category_id: "a" }),
        item({ quantity: 1, unit_value: 1, company_category_id: "b" }),
      ]),
    ).toBe(true);
    expect(
      boletoHasMultipleItemCategories([
        item({ quantity: 1, unit_value: 1, company_category_id: "a" }),
        item({ quantity: 1, unit_value: 1, company_category_id: "a" }),
      ]),
    ).toBe(false);
  });
});

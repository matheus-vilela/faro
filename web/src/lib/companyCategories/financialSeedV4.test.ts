import { describe, expect, it } from "vitest";
import {
  FINANCIAL_SEED_V4,
  pickExistingDreLeafName,
  VARIABLE_DRE_LEAF_CANDIDATES,
} from "./financialSeedV4";

describe("FINANCIAL_SEED_V4", () => {
  it("tem 11 contas com tipos do motor e Ativos fora do P&L", () => {
    expect(FINANCIAL_SEED_V4).toHaveLength(11);
    const ativos = FINANCIAL_SEED_V4.find((a) => a.name === "Ativos");
    expect(ativos).toMatchObject({
      natureza: "DESPESA",
      tipo: "INVESTIMENTOS_FINANCIAMENTOS",
      incluir_no_dre: false,
    });
    const variaveis = FINANCIAL_SEED_V4.find(
      (a) => a.name === "Despesas Variáveis",
    );
    expect(variaveis).toMatchObject({
      natureza: "DESPESA",
      tipo: "VARIAVEL",
      incluir_no_dre: true,
    });
    const bruta = FINANCIAL_SEED_V4.find(
      (a) => a.name === "Receita Bruta de Vendas",
    );
    expect(bruta).toMatchObject({
      natureza: "RECEITA",
      tipo: "OPERACIONAL",
      papel_receita_dre: "BRUTA",
    });
    const deducao = FINANCIAL_SEED_V4.find(
      (a) => a.name === "Deduções de Receita",
    );
    expect(deducao?.papel_receita_dre).toBe("DEDUCAO");
    expect(FINANCIAL_SEED_V4.some((a) => a.tipo === "CMV")).toBe(false);
  });
});

describe("pickExistingDreLeafName", () => {
  it("no plano v3 não usa o grupo Despesas Variáveis", () => {
    expect(
      pickExistingDreLeafName(
        ["Custos de franquia", "Outras - Variáveis"],
        VARIABLE_DRE_LEAF_CANDIDATES,
      ),
    ).toBe("Outras - Variáveis");
  });

  it("no plano v4 usa a folha Despesas Variáveis", () => {
    expect(
      pickExistingDreLeafName(
        ["Despesas Variáveis", "Despesas Administrativas"],
        VARIABLE_DRE_LEAF_CANDIDATES,
      ),
    ).toBe("Despesas Variáveis");
  });

  it("aceita null quando não há folha", () => {
    expect(
      pickExistingDreLeafName(["Despesas Variáveis"], ["Outras - Variáveis"]),
    ).toBeNull();
  });
});

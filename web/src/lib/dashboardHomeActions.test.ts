import { describe, expect, it } from "vitest";
import {
  buildHomeInsightText,
  type BuildHomeInsightInput,
} from "./dashboardHomeActions";

const EMPTY: BuildHomeInsightInput = {
  loading: false,
  periodLabel: "da semana",
  faturamento: 0,
  faturamentoDeltaPct: null,
  hasPeriodSales: false,
  actionCount: 0,
  payablesTodayCount: 0,
  payablesTodayAmount: 0,
  payablesTomorrowCount: 0,
  payablesTomorrowAmount: 0,
  dueIn7Count: 0,
  dueIn7Amount: 0,
  lucroMes: null,
  marginPct: null,
};

function insight(override: Partial<BuildHomeInsightInput> = {}): string {
  return buildHomeInsightText({ ...EMPTY, ...override });
}

describe("buildHomeInsightText", () => {
  it("mostra checagem enquanto carrega, mesmo com outros dados", () => {
    expect(
      insight({
        loading: true,
        payablesTodayCount: 2,
        payablesTodayAmount: 1240,
        actionCount: 5,
        hasPeriodSales: true,
        faturamento: 100,
      }),
    ).toBe("Estou checando o que precisa de você…");
  });

  it("prioriza contas de hoje no singular e no plural", () => {
    expect(
      insight({
        payablesTodayCount: 1,
        payablesTodayAmount: 1240,
        actionCount: 5,
        hasPeriodSales: true,
        faturamento: 100,
      }),
    ).toBe("Hoje vence 1 conta de R$\u00a01.240,00.");

    expect(
      insight({
        payablesTodayCount: 3,
        payablesTodayAmount: 1240,
      }),
    ).toBe("Hoje vencem 3 contas, somando R$\u00a01.240,00.");
  });

  it("usa contas de amanhã só quando não há contas hoje", () => {
    expect(
      insight({
        payablesTomorrowCount: 1,
        payablesTomorrowAmount: 800,
        actionCount: 2,
      }),
    ).toBe("Amanhã vence 1 conta de R$\u00a0800,00.");

    expect(
      insight({
        payablesTomorrowCount: 2,
        payablesTomorrowAmount: 800,
      }),
    ).toBe("Amanhã vencem 2 contas, somando R$\u00a0800,00.");
  });

  it("cita pendências depois de contas hoje/amanhã", () => {
    expect(insight({ actionCount: 1 })).toBe(
      "Deixei 1 coisa esperando você ali embaixo — alguns minutos e tá tudo em dia.",
    );
    expect(insight({ actionCount: 5, dueIn7Count: 4, dueIn7Amount: 3200 })).toBe(
      "Deixei 5 coisas esperando você ali embaixo — alguns minutos e tá tudo em dia.",
    );
  });

  it("cita contas dos próximos 7 dias quando não há hoje, amanhã nem pendências", () => {
    expect(insight({ dueIn7Count: 1, dueIn7Amount: 500 })).toBe(
      "Tem 1 conta a vencer nos próximos 7 dias, somando R$\u00a0500,00.",
    );
    expect(insight({ dueIn7Count: 4, dueIn7Amount: 3200 })).toBe(
      "Tem 4 contas a vencer nos próximos 7 dias, somando R$\u00a03.200,00.",
    );
  });

  it("cita faturamento com delta só quando há venda real acima de zero", () => {
    expect(
      insight({
        hasPeriodSales: true,
        faturamento: 12400,
        faturamentoDeltaPct: 8,
      }),
    ).toBe(
      "Seu faturamento da semana está em R$\u00a012.400,00 (+8% vs período anterior).",
    );

    expect(
      insight({
        hasPeriodSales: true,
        faturamento: 12400,
        faturamentoDeltaPct: -3,
        periodLabel: "do mês",
      }),
    ).toBe(
      "Seu faturamento do mês está em R$\u00a012.400,00 (-3% vs período anterior).",
    );
  });

  it("não cita R$ 0,00 mesmo com hasPeriodSales", () => {
    const text = insight({
      hasPeriodSales: true,
      faturamento: 0,
      faturamentoDeltaPct: 10,
      lucroMes: null,
      marginPct: null,
    });
    expect(text).not.toMatch(/R\$/);
    expect(text).toBe(
      "Nada urgente agora — quando houver vendas, contas ou pendências, eu te aviso aqui.",
    );
  });

  it("cita lucro do mês (inclusive negativo) depois do faturamento", () => {
    expect(insight({ lucroMes: 4200 })).toBe(
      "O lucro do mês está em R$\u00a04.200,00.",
    );
    expect(insight({ lucroMes: -150 })).toBe(
      "O lucro do mês está em -R$\u00a0150,00.",
    );
  });

  it("cita margem só quando não há lucro", () => {
    expect(insight({ marginPct: 32.4 })).toBe(
      "A margem do período está em 32%.",
    );
    expect(insight({ lucroMes: 100, marginPct: 32 })).toBe(
      "O lucro do mês está em R$\u00a0100,00.",
    );
  });

  it("usa fallback genérico quando não há dados", () => {
    expect(insight()).toBe(
      "Nada urgente agora — quando houver vendas, contas ou pendências, eu te aviso aqui.",
    );
  });
});

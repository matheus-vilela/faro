import { describe, expect, it } from "vitest";
import {
  buildNetSalesSourceBreakdown,
  buildPaymentsFromEpoc,
  buildVendasRealizadasResumo,
  sumFaturamentoMetrics,
} from "@/lib/vendasRealizadasResumo";

describe("buildPaymentsFromEpoc", () => {
  it("agrega por forma e calcula participação (sem transações/tíquete)", () => {
    const rows = buildPaymentsFromEpoc([
      {
        faturamento_date: "2026-07-01",
        amount: 100,
        payment_method_id: "pm-pix",
        payment_methods: { sku: "PIX", name: "Pix" },
      },
      {
        faturamento_date: "2026-07-02",
        amount: 50,
        payment_method_id: "pm-pix",
        payment_methods: { sku: "PIX", name: "Pix" },
      },
      {
        faturamento_date: "2026-07-01",
        amount: 150,
        payment_method_id: "pm-cred",
        payment_methods: { sku: "CRED", name: "Cartão de crédito" },
      },
    ]);

    expect(rows).toHaveLength(2);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey["pm-cred"]).toMatchObject({
      label: "Cartão de crédito",
      amount: 150,
      share: 0.5,
      includeInNetSales: true,
    });
    expect(byKey["pm-pix"]).toMatchObject({
      label: "Pix",
      amount: 150,
      share: 0.5,
      includeInNetSales: true,
    });
    expect(byKey["pm-pix"]).not.toHaveProperty("count");
    expect(byKey["pm-pix"]).not.toHaveProperty("ticket");
    expect(byKey["pm-pix"].acquirerName).toBeNull();
  });

  it("propaga o nome da adquirente associada à forma", () => {
    const rows = buildPaymentsFromEpoc([
      {
        faturamento_date: "2026-07-01",
        amount: 80,
        payment_method_id: "pm-cred",
        payment_methods: {
          sku: "CRED",
          name: "Cartão de crédito",
          acquirer_name: "Stone",
        },
      },
      {
        faturamento_date: "2026-07-02",
        amount: 20,
        payment_method_id: "pm-cred",
        payment_methods: {
          sku: "CRED",
          name: "Cartão de crédito",
          acquirer_name: "Stone",
        },
      },
    ]);
    expect(rows[0]).toMatchObject({
      label: "Cartão de crédito",
      amount: 100,
      acquirerName: "Stone",
    });
  });

  it("marca formas com include_in_net_sales=false", () => {
    const rows = buildPaymentsFromEpoc([
      {
        faturamento_date: "2026-07-01",
        amount: 100,
        payment_method_id: "pm-pix",
        payment_methods: { sku: "PIX", name: "Pix", include_in_net_sales: true },
      },
      {
        faturamento_date: "2026-07-01",
        amount: 40,
        payment_method_id: "pm-reb",
        payment_methods: {
          sku: "REEMB",
          name: "Reembolso",
          include_in_net_sales: false,
        },
      },
    ]);
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey["pm-reb"].includeInNetSales).toBe(false);
    expect(byKey["pm-pix"].includeInNetSales).toBe(true);
  });
});

describe("sumFaturamentoMetrics", () => {
  it("soma total/produtos+serviços/quantidade e tíquete ponderado", () => {
    const m = sumFaturamentoMetrics([
      {
        faturamento_date: "2026-07-01",
        quantity: 10,
        produtos: 80,
        servicos: 20,
        taxas: 10,
        total: 110,
        ticket_medio: 11,
      },
      {
        faturamento_date: "2026-07-02",
        quantity: 5,
        produtos: 40,
        servicos: 10,
        taxas: 5,
        total: 55,
        ticket_medio: 11,
      },
    ]);
    expect(m.gross).toBe(165);
    expect(m.net).toBe(150);
    expect(m.count).toBe(15);
    expect(m.ticket).toBe(11);
  });
});

describe("buildVendasRealizadasResumo KPIs por período", () => {
  const emptyMaps = {
    categoriesById: new Map(),
    productNameById: new Map(),
    recipeNameById: new Map(),
  };

  it("usa EPOC só do período atual (não zera quando só o anterior tem faturamento)", () => {
    const dash = buildVendasRealizadasResumo({
      ...emptyMaps,
      period: "today",
      todayYmd: "2026-07-30",
      rankingMode: "product",
      entries: [
        {
          id: "re-1",
          company_id: "co",
          created_by: null,
          entry_date: "2026-07-30",
          title: "Venda",
          entry_mode: "manual",
          revenue_type: "operational",
          category_id: null,
          subcategory_id: "sub",
          product_id: null,
          recipe_id: null,
          quantity: 1,
          pricing_mode: null,
          unit_value: null,
          gross_amount: 200,
          tax_type: "currency",
          tax_value: 0,
          tax_amount: 0,
          net_amount: 200,
          source: "manual",
          created_at: "",
          updated_at: "",
        },
      ],
      epocFaturamentoDays: [
        {
          faturamento_date: "2026-07-29",
          quantity: 10,
          produtos: 80,
          servicos: 20,
          taxas: 10,
          total: 110,
          ticket_medio: 11,
        },
      ],
    });

    // Período atual (hoje) sem EPOC → cai nos lançamentos do dia.
    expect(dash.kpis.gross.current).toBe(200);
    expect(dash.kpis.net.current).toBe(200);
    expect(dash.kpis.count.current).toBe(1);
    // Comparação (ontem) usa EPOC.
    expect(dash.kpis.gross.previous).toBe(110);
    expect(dash.kpis.net.previous).toBe(100);
    expect(dash.kpis.count.previous).toBe(10);
    expect(dash.hasPeriodSales).toBe(true);
  });

  it("soma faturamento EPOC apenas nos dias da semana contábil (segunda→hoje)", () => {
    const dash = buildVendasRealizadasResumo({
      ...emptyMaps,
      period: "last7",
      todayYmd: "2026-07-30", // quinta
      weekStartsOn: 1, // segunda
      rankingMode: "product",
      entries: [],
      epocFaturamentoDays: [
        {
          faturamento_date: "2026-07-20", // fora
          quantity: 99,
          produtos: 900,
          servicos: 0,
          taxas: 0,
          total: 900,
          ticket_medio: 9,
        },
        {
          faturamento_date: "2026-07-26", // domingo — fora (semana começa seg 27)
          quantity: 1,
          produtos: 10,
          servicos: 0,
          taxas: 0,
          total: 10,
          ticket_medio: 10,
        },
        {
          faturamento_date: "2026-07-28",
          quantity: 4,
          produtos: 40,
          servicos: 10,
          taxas: 5,
          total: 55,
          ticket_medio: 13.75,
        },
        {
          faturamento_date: "2026-07-30",
          quantity: 6,
          produtos: 60,
          servicos: 0,
          taxas: 0,
          total: 60,
          ticket_medio: 10,
        },
      ],
    });

    expect(dash.ranges.currentStart).toBe("2026-07-27");
    expect(dash.ranges.currentEnd).toBe("2026-07-30");
    expect(dash.kpis.gross.current).toBe(115);
    expect(dash.kpis.net.current).toBe(110);
    expect(dash.kpis.count.current).toBe(10);
    expect(dash.daily).toHaveLength(4);
    expect(dash.daily.find((d) => d.date === "2026-07-28")?.net).toBe(50);
    expect(dash.daily.find((d) => d.date === "2026-07-26")).toBeUndefined();
  });

  it("semana contábil começando na quinta (Qui→Qua)", () => {
    const dash = buildVendasRealizadasResumo({
      ...emptyMaps,
      period: "last7",
      todayYmd: "2026-07-30", // quinta
      weekStartsOn: 4,
      rankingMode: "product",
      entries: [],
      epocFaturamentoDays: [
        {
          faturamento_date: "2026-07-30",
          quantity: 2,
          produtos: 50,
          servicos: 0,
          taxas: 0,
          total: 50,
          ticket_medio: 25,
        },
      ],
    });

    expect(dash.ranges.currentStart).toBe("2026-07-30");
    expect(dash.ranges.currentEnd).toBe("2026-07-30");
    expect(dash.ranges.previousStart).toBe("2026-07-23");
    expect(dash.ranges.previousEnd).toBe("2026-07-23");
  });

  it("usa soma das formas de pagamento como vendas líquidas quando há EPOC payments", () => {
    const dash = buildVendasRealizadasResumo({
      ...emptyMaps,
      period: "today",
      todayYmd: "2026-07-30",
      rankingMode: "payment",
      entries: [],
      epocFaturamentoDays: [
        {
          faturamento_date: "2026-07-30",
          quantity: 5,
          produtos: 80,
          servicos: 20,
          taxas: 10,
          total: 110,
          ticket_medio: 22,
        },
      ],
      epocPayments: [
        {
          faturamento_date: "2026-07-30",
          amount: 90,
          payment_method_id: "pm-cash",
          payment_methods: { sku: "cash", name: "Dinheiro" },
        },
        {
          faturamento_date: "2026-07-30",
          amount: 25,
          payment_method_id: "pm-pend",
          payment_methods: { sku: "pendura", name: "Pendura" },
        },
      ],
    });

    expect(dash.kpis.gross.current).toBe(110);
    expect(dash.kpis.net.current).toBe(115);
    expect(dash.daily.find((d) => d.date === "2026-07-30")?.net).toBe(115);
  });

  it("exclui formas com include_in_net_sales=false do KPI de líquidas", () => {
    const dash = buildVendasRealizadasResumo({
      ...emptyMaps,
      period: "today",
      todayYmd: "2026-07-30",
      rankingMode: "payment",
      entries: [],
      epocFaturamentoDays: [
        {
          faturamento_date: "2026-07-30",
          quantity: 5,
          produtos: 80,
          servicos: 20,
          taxas: 0,
          total: 100,
          ticket_medio: 20,
        },
      ],
      epocPayments: [
        {
          faturamento_date: "2026-07-30",
          amount: 100,
          payment_method_id: "pm-cash",
          payment_methods: {
            sku: "cash",
            name: "Dinheiro",
            include_in_net_sales: true,
          },
        },
        {
          faturamento_date: "2026-07-30",
          amount: 30,
          payment_method_id: "pm-reb",
          payment_methods: {
            sku: "reemb",
            name: "Reembolso",
            include_in_net_sales: false,
          },
        },
      ],
    });

    expect(dash.kpis.net.current).toBe(100);
    expect(dash.daily.find((d) => d.date === "2026-07-30")?.net).toBe(100);
    expect(dash.payments.find((p) => p.key === "pm-reb")?.includeInNetSales).toBe(
      false,
    );
    expect(dash.payments.find((p) => p.key === "pm-reb")?.amount).toBe(30);
  });

  it("respeita período personalizado e compara janela anterior de mesmo tamanho", () => {
    const dash = buildVendasRealizadasResumo({
      ...emptyMaps,
      period: "custom",
      todayYmd: "2026-07-30",
      customRange: { start: "2026-07-28", end: "2026-07-29" },
      rankingMode: "product",
      entries: [],
      epocFaturamentoDays: [
        {
          faturamento_date: "2026-07-26",
          quantity: 1,
          produtos: 10,
          servicos: 0,
          taxas: 0,
          total: 10,
          ticket_medio: 10,
        },
        {
          faturamento_date: "2026-07-27",
          quantity: 1,
          produtos: 20,
          servicos: 0,
          taxas: 0,
          total: 20,
          ticket_medio: 20,
        },
        {
          faturamento_date: "2026-07-28",
          quantity: 2,
          produtos: 40,
          servicos: 5,
          taxas: 3,
          total: 48,
          ticket_medio: 24,
        },
        {
          faturamento_date: "2026-07-29",
          quantity: 3,
          produtos: 30,
          servicos: 0,
          taxas: 0,
          total: 30,
          ticket_medio: 10,
        },
      ],
    });

    expect(dash.ranges.currentStart).toBe("2026-07-28");
    expect(dash.ranges.currentEnd).toBe("2026-07-29");
    expect(dash.ranges.previousStart).toBe("2026-07-26");
    expect(dash.ranges.previousEnd).toBe("2026-07-27");
    expect(dash.kpis.gross.current).toBe(78);
    expect(dash.kpis.net.current).toBe(75);
    expect(dash.kpis.gross.previous).toBe(30);
    expect(dash.kpis.net.previous).toBe(30);
  });
});

describe("buildNetSalesSourceBreakdown", () => {
  it("lista fontes e diff vs KPI", () => {
    const rows = buildNetSalesSourceBreakdown({
      fatDays: [
        {
          faturamento_date: "2026-07-30",
          quantity: 2,
          produtos: 80,
          servicos: 20,
          taxas: 10,
          total: 110,
          ticket_medio: 55,
        },
      ],
      epocPayments: [
        {
          faturamento_date: "2026-07-30",
          amount: 90,
          payment_method_id: "pm",
          payment_methods: { sku: "cash", name: "Dinheiro" },
        },
        {
          faturamento_date: "2026-07-30",
          amount: 20,
          payment_method_id: "pm-pend",
          payment_methods: { sku: "pendura", name: "Pendura" },
        },
      ],
      revenueEntries: [],
      serviceDailySalesTotal: 20,
      kpiNet: 100,
      kpiGross: 110,
    });

    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.kpi_net.value).toBe(100);
    expect(byKey.epoc_prod_serv.value).toBe(100);
    expect(byKey.epoc_prod_serv.diffVsKpiNet).toBe(0);
    expect(byKey.epoc_total_menos_taxas.value).toBe(100);
    expect(byKey.epoc_pagamentos.value).toBe(110);
    expect(byKey.epoc_pagamentos.diffVsKpiNet).toBe(10);
    expect(byKey.epoc_pagamentos.note).toMatch(/Inclui pendura/);
    expect(byKey.epoc_pendura.value).toBe(20);
    expect(byKey.epoc_pendura.emphasis).toBe(true);
    expect(byKey.service_daily.value).toBe(20);
  });
});

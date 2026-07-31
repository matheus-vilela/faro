import { describe, expect, it } from "vitest";
import {
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
    });
    expect(byKey["pm-pix"]).toMatchObject({
      label: "Pix",
      amount: 150,
      share: 0.5,
    });
    expect(byKey["pm-pix"]).not.toHaveProperty("count");
    expect(byKey["pm-pix"]).not.toHaveProperty("ticket");
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

  it("soma faturamento EPOC apenas nos dias do filtro last7", () => {
    const dash = buildVendasRealizadasResumo({
      ...emptyMaps,
      period: "last7",
      todayYmd: "2026-07-30",
      rankingMode: "product",
      entries: [],
      epocFaturamentoDays: [
        {
          faturamento_date: "2026-07-20", // fora do período atual
          quantity: 99,
          produtos: 900,
          servicos: 0,
          taxas: 0,
          total: 900,
          ticket_medio: 9,
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

    expect(dash.kpis.gross.current).toBe(115);
    expect(dash.kpis.net.current).toBe(110);
    expect(dash.kpis.count.current).toBe(10);
    expect(dash.kpis.ticket.current).toBe(11.5);
    expect(dash.daily).toHaveLength(7);
    expect(dash.daily.find((d) => d.date === "2026-07-28")?.net).toBe(50);
    expect(dash.daily.find((d) => d.date === "2026-07-20")).toBeUndefined();
  });
});

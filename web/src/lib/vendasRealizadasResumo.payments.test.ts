import { describe, expect, it } from "vitest";
import {
  buildPaymentsFromEpoc,
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

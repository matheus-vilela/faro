import { describe, expect, it } from "vitest";
import {
  applyScenarioToRawItems,
  buildWeeklyBuckets,
  computeCashFlowProjection,
  getMondayOfWeekYmd,
  parseOpeningBalance,
  resolveBucketAssignmentYmd,
  toRawCashFlowItem,
} from "./computeCashFlowProjection";

describe("computeCashFlowProjection", () => {
  const todayYmd = "2026-07-27"; // segunda-feira

  it("monta buckets semanais Seg–Dom", () => {
    const buckets = buildWeeklyBuckets(todayYmd, 4, 1);
    expect(buckets).toHaveLength(4);
    expect(buckets[0].startYmd).toBe("2026-07-27");
    expect(buckets[0].endYmd).toBe("2026-08-02");
    expect(buckets[1].startYmd).toBe("2026-08-03");
  });

  it("semana 1 segue o início contábil do estabelecimento", () => {
    // 2026-07-30 é quinta; semana Qui–Qua começa em 30/07.
    const buckets = buildWeeklyBuckets("2026-08-02", 4, 4);
    expect(buckets[0].startYmd).toBe("2026-07-30");
    expect(buckets[0].endYmd).toBe("2026-08-05");
    expect(buckets[1].startYmd).toBe("2026-08-06");
  });

  it("aloca entradas e saídas na semana contábil respectiva", () => {
    const result = computeCashFlowProjection({
      rawItems: [
        toRawCashFlowItem({
          id: "in-w1",
          direction: "inflow",
          amount: 100,
          dueDateYmd: "2026-07-31", // qui na semana Qui–Qua
        }),
        toRawCashFlowItem({
          id: "out-w2",
          direction: "outflow",
          amount: 40,
          dueDateYmd: "2026-08-07", // sex na semana seguinte
        }),
      ],
      scenario: "base",
      openingBalance: 0,
      todayYmd: "2026-07-31",
      horizonWeeks: 4,
      weekStartsOn: 4,
    });

    expect(result.buckets[0].startYmd).toBe("2026-07-30");
    expect(result.buckets[0].inflows).toBe(100);
    expect(result.buckets[0].outflows).toBe(0);
    expect(result.buckets[1].inflows).toBe(0);
    expect(result.buckets[1].outflows).toBe(40);
  });

  it("calcula saldo acumulado com saldo inicial manual", () => {
    const rawItems = [
      toRawCashFlowItem({
        id: "1",
        direction: "inflow",
        amount: 1000,
        dueDateYmd: "2026-07-28",
      }),
      toRawCashFlowItem({
        id: "2",
        direction: "outflow",
        amount: 400,
        dueDateYmd: "2026-07-29",
      }),
    ];

    const result = computeCashFlowProjection({
      rawItems,
      scenario: "base",
      openingBalance: 500,
      todayYmd,
      horizonWeeks: 4,
    });

    expect(result.kpis.openingBalance).toBe(500);
    expect(result.kpis.totalInflows).toBe(1000);
    expect(result.kpis.totalOutflows).toBe(400);
    expect(result.kpis.endingBalance).toBe(1100);
    expect(result.buckets[0].runningBalance).toBe(1100);
    expect(result.buckets[0].items).toHaveLength(2);
  });

  it("cenário otimista altera posição dos valores vs base", () => {
    const due = "2026-08-10";
    const raw = toRawCashFlowItem({
      id: "r1",
      direction: "inflow",
      amount: 500,
      dueDateYmd: due,
    });
    const baseItem = applyScenarioToRawItems([raw], "base", todayYmd)[0];
    const optItem = applyScenarioToRawItems([raw], "optimistic", todayYmd)[0];

    expect(baseItem.simulatedDateYmd).toBe("2026-08-10");
    expect(optItem.simulatedDateYmd).toBe("2026-08-07");
  });

  it("itens antes da semana 1 ficam fora dos buckets (não agrupam na semana atual)", () => {
    const rawItems = [
      toRawCashFlowItem({
        id: "past-in",
        direction: "inflow",
        amount: 50_000,
        dueDateYmd: "2026-06-01",
        isSettled: true,
      }),
      toRawCashFlowItem({
        id: "past-pending",
        direction: "outflow",
        amount: 300,
        dueDateYmd: "2026-06-15",
      }),
      toRawCashFlowItem({
        id: "w1-in",
        direction: "inflow",
        amount: 100,
        dueDateYmd: "2026-07-28",
      }),
    ];

    const result = computeCashFlowProjection({
      rawItems,
      scenario: "base",
      openingBalance: 1000,
      todayYmd,
      horizonWeeks: 4,
    });

    expect(result.buckets[0].inflows).toBe(100);
    expect(result.buckets[0].outflows).toBe(0);
    expect(result.kpis.totalInflows).toBe(100);
    expect(result.kpis.endingBalance).toBe(1100);
  });

  it("liquidados usam data definitiva; pendentes aplicam offset sem reancorar em hoje", () => {
    const settled = toRawCashFlowItem({
      id: "paid",
      direction: "inflow",
      amount: 500,
      dueDateYmd: "2026-08-10",
      isSettled: true,
    });
    const pending = toRawCashFlowItem({
      id: "pend",
      direction: "inflow",
      amount: 500,
      dueDateYmd: "2026-08-10",
    });

    const settledSim = applyScenarioToRawItems([settled], "optimistic", todayYmd)[0];
    const pendingSim = applyScenarioToRawItems([pending], "optimistic", todayYmd)[0];

    expect(settledSim.simulatedDateYmd).toBe("2026-08-10");
    expect(pendingSim.simulatedDateYmd).toBe("2026-08-07");
  });

  it("cenários redistribuem pendentes futuros a partir do vencimento", () => {
    const payable = toRawCashFlowItem({
      id: "p-future",
      direction: "outflow",
      amount: 1000,
      dueDateYmd: "2026-08-10",
    });
    const receivable = toRawCashFlowItem({
      id: "r-future",
      direction: "inflow",
      amount: 2000,
      dueDateYmd: "2026-08-10",
    });

    const base = computeCashFlowProjection({
      rawItems: [payable, receivable],
      scenario: "base",
      openingBalance: 0,
      todayYmd,
      horizonWeeks: 4,
    });
    const optimistic = computeCashFlowProjection({
      rawItems: [payable, receivable],
      scenario: "optimistic",
      openingBalance: 0,
      todayYmd,
      horizonWeeks: 4,
    });
    const pessimistic = computeCashFlowProjection({
      rawItems: [payable, receivable],
      scenario: "pessimistic",
      openingBalance: 0,
      todayYmd,
      horizonWeeks: 4,
    });

    // Base: ambos em 10/08 → semana índice 2 (10–16/08).
    expect(base.buckets[2].outflows).toBe(1000);
    expect(base.buckets[2].inflows).toBe(2000);
    // Otimista: entrada −3d (07/08 → sem. 1), saída +7d (17/08 → sem. 3).
    expect(optimistic.buckets[1].inflows).toBe(2000);
    expect(optimistic.buckets[2].outflows).toBe(0);
    expect(optimistic.buckets[3].outflows).toBe(1000);
    // Pessimista: saída 0d (sem. 2), entrada +7d (17/08 → sem. 3).
    expect(pessimistic.buckets[2].outflows).toBe(1000);
    expect(pessimistic.buckets[2].inflows).toBe(0);
    expect(pessimistic.buckets[3].inflows).toBe(2000);
  });

  it("parseOpeningBalance trata NaN como 0", () => {
    expect(parseOpeningBalance("abc")).toBe(0);
    expect(parseOpeningBalance("")).toBe(0);
    expect(parseOpeningBalance(null)).toBe(0);
    expect(parseOpeningBalance(1500)).toBe(1500);
  });

  it("range vazio produz buckets zerados sem erro", () => {
    const result = computeCashFlowProjection({
      rawItems: [],
      scenario: "base",
      openingBalance: 0,
      todayYmd,
      horizonWeeks: 4,
    });

    expect(result.buckets).toHaveLength(4);
    expect(result.kpis.totalInflows).toBe(0);
    expect(result.kpis.totalOutflows).toBe(0);
    expect(result.kpis.endingBalance).toBe(0);
  });

  it("resolveBucketAssignmentYmd preserva a data (não empurra passado para semana 1)", () => {
    const firstMonday = getMondayOfWeekYmd(todayYmd);
    expect(
      resolveBucketAssignmentYmd("2026-05-01", todayYmd, firstMonday),
    ).toBe("2026-05-01");
    expect(
      resolveBucketAssignmentYmd("2026-08-01", todayYmd, firstMonday),
    ).toBe("2026-08-01");
  });

  it("cenário pessimista aloca item além do horizonte na última semana", () => {
    const buckets = buildWeeklyBuckets(todayYmd, 4);
    const lastWeekEnd = buckets[buckets.length - 1].endYmd;
    const rawItems = [
      toRawCashFlowItem({
        id: "late",
        direction: "inflow",
        amount: 800,
        dueDateYmd: lastWeekEnd,
      }),
    ];

    const result = computeCashFlowProjection({
      rawItems,
      scenario: "pessimistic",
      openingBalance: 0,
      todayYmd,
      horizonWeeks: 4,
    });

    expect(result.kpis.totalInflows).toBe(800);
    expect(result.meta.clampedToLastBucketCount).toBe(1);
    expect(result.buckets[3].inflows).toBe(800);
    expect(result.buckets[3].items[0]?.clampedToHorizon).toBe(true);
  });
});

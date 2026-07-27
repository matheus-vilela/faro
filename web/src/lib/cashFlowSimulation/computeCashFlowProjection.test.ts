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
    const buckets = buildWeeklyBuckets(todayYmd, 4);
    expect(buckets).toHaveLength(4);
    expect(buckets[0].startYmd).toBe("2026-07-27");
    expect(buckets[0].endYmd).toBe("2026-08-02");
    expect(buckets[1].startYmd).toBe("2026-08-03");
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

  it("cenários redistribuem vencidas a partir de hoje", () => {
    const overduePayable = toRawCashFlowItem({
      id: "p-overdue",
      direction: "outflow",
      amount: 1000,
      dueDateYmd: "2026-05-01",
    });
    const overdueReceivable = toRawCashFlowItem({
      id: "r-overdue",
      direction: "inflow",
      amount: 2000,
      dueDateYmd: "2026-06-15",
    });

    const base = computeCashFlowProjection({
      rawItems: [overduePayable, overdueReceivable],
      scenario: "base",
      openingBalance: 0,
      todayYmd,
      horizonWeeks: 4,
    });
    const optimistic = computeCashFlowProjection({
      rawItems: [overduePayable, overdueReceivable],
      scenario: "optimistic",
      openingBalance: 0,
      todayYmd,
      horizonWeeks: 4,
    });
    const pessimistic = computeCashFlowProjection({
      rawItems: [overduePayable, overdueReceivable],
      scenario: "pessimistic",
      openingBalance: 0,
      todayYmd,
      horizonWeeks: 4,
    });

    expect(base.buckets[0].outflows).toBe(1000);
    expect(base.buckets[0].inflows).toBe(2000);
    expect(optimistic.buckets[0].outflows).toBe(0);
    expect(optimistic.buckets[0].inflows).toBe(2000);
    expect(optimistic.buckets.some((b) => b.outflows === 1000)).toBe(true);
    expect(pessimistic.buckets[0].outflows).toBe(1000);
    expect(pessimistic.buckets[0].inflows).toBe(0);
    expect(pessimistic.buckets.some((b) => b.inflows === 2000)).toBe(true);
  });

  it("vencidas pendentes caem na semana 1", () => {
    const rawItems = [
      toRawCashFlowItem({
        id: "overdue",
        direction: "outflow",
        amount: 300,
        dueDateYmd: "2026-06-01",
      }),
    ];

    const result = computeCashFlowProjection({
      rawItems,
      scenario: "base",
      openingBalance: 1000,
      todayYmd,
      horizonWeeks: 4,
    });

    expect(result.buckets[0].outflows).toBe(300);
    expect(result.buckets[1].outflows).toBe(0);
    expect(result.kpis.endingBalance).toBe(700);
    expect(result.buckets[0].items[0]?.isOverdue).toBe(true);
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

  it("resolveBucketAssignmentYmd envia vencidas para início da semana 1", () => {
    const firstMonday = getMondayOfWeekYmd(todayYmd);
    expect(
      resolveBucketAssignmentYmd("2026-05-01", todayYmd, firstMonday),
    ).toBe(firstMonday);
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

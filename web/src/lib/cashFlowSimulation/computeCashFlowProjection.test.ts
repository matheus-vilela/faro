import { describe, expect, it } from "vitest";
import {
  buildWeeklyBuckets,
  computeCashFlowProjection,
  getMondayOfWeekYmd,
  parseOpeningBalance,
  resolveBucketAssignmentYmd,
  toCashFlowItem,
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
    const items = [
      toCashFlowItem({
        id: "1",
        direction: "inflow",
        amount: 1000,
        dueDateYmd: "2026-07-28",
        scenario: "base",
      }),
      toCashFlowItem({
        id: "2",
        direction: "outflow",
        amount: 400,
        dueDateYmd: "2026-07-29",
        scenario: "base",
      }),
    ];

    const result = computeCashFlowProjection({
      items,
      openingBalance: 500,
      todayYmd,
      horizonWeeks: 4,
    });

    expect(result.kpis.openingBalance).toBe(500);
    expect(result.kpis.totalInflows).toBe(1000);
    expect(result.kpis.totalOutflows).toBe(400);
    expect(result.kpis.endingBalance).toBe(1100);
    expect(result.buckets[0].runningBalance).toBe(1100);
  });

  it("cenário otimista altera posição dos valores vs base", () => {
    const due = "2026-08-10";
    const baseItem = toCashFlowItem({
      id: "r1",
      direction: "inflow",
      amount: 500,
      dueDateYmd: due,
      scenario: "base",
    });
    const optItem = toCashFlowItem({
      id: "r1",
      direction: "inflow",
      amount: 500,
      dueDateYmd: due,
      scenario: "optimistic",
    });

    expect(baseItem.simulatedDateYmd).toBe("2026-08-10");
    expect(optItem.simulatedDateYmd).toBe("2026-08-07");
  });

  it("vencidas pendentes caem na semana 1", () => {
    const items = [
      toCashFlowItem({
        id: "overdue",
        direction: "outflow",
        amount: 300,
        dueDateYmd: "2026-06-01",
        scenario: "base",
      }),
    ];

    const result = computeCashFlowProjection({
      items,
      openingBalance: 1000,
      todayYmd,
      horizonWeeks: 4,
    });

    expect(result.buckets[0].outflows).toBe(300);
    expect(result.buckets[1].outflows).toBe(0);
    expect(result.kpis.endingBalance).toBe(700);
  });

  it("parseOpeningBalance trata NaN como 0", () => {
    expect(parseOpeningBalance("abc")).toBe(0);
    expect(parseOpeningBalance("")).toBe(0);
    expect(parseOpeningBalance(null)).toBe(0);
    expect(parseOpeningBalance(1500)).toBe(1500);
  });

  it("range vazio produz buckets zerados sem erro", () => {
    const result = computeCashFlowProjection({
      items: [],
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
});

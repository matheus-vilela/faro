import { describe, expect, it } from "vitest";
import {
  accumulateAssignmentKpis,
  buildOverviewDashboard,
  completionRate,
  finishedAttributedToYmd,
  overviewPeriodRange,
} from "./checklistOverview";
import { expectedOnYmd, expectedOnYmdInRange } from "./checklistRecurrence";
import { spMondayOfWeek } from "./checklistSpDay";

const dailyAllWeek = {
  recurrence_kind: "daily" as const,
  daily_executions_per_day: 1,
  weekday_mask: 127,
  monthly_executions: null,
};

describe("checklistOverview", () => {
  it("counts finished vs remaining today without deadline as not started", () => {
    const kpis = accumulateAssignmentKpis({
      ymds: ["2026-08-29"],
      todayYmd: "2026-08-29",
      expectedOnYmd: () => 2,
      finishedOnYmd: () => 1,
      openCount: 0,
      isPastDue: () => false,
    });
    expect(kpis.scheduled).toBe(2);
    expect(kpis.finished).toBe(1);
    expect(kpis.notStarted).toBe(1);
    expect(kpis.inProgress).toBe(0);
    expect(kpis.late).toBe(0);
  });

  it("uses open runs as in progress and leftover past due as late", () => {
    const kpis = accumulateAssignmentKpis({
      ymds: ["2026-08-29"],
      todayYmd: "2026-08-29",
      expectedOnYmd: () => 3,
      finishedOnYmd: () => 0,
      openCount: 1,
      isPastDue: () => true,
    });
    expect(kpis.inProgress).toBe(1);
    expect(kpis.late).toBe(2);
  });

  it("marks previous days without finish as late", () => {
    const kpis = accumulateAssignmentKpis({
      ymds: ["2026-08-28", "2026-08-29"],
      todayYmd: "2026-08-29",
      expectedOnYmd: () => 1,
      finishedOnYmd: () => 0,
      openCount: 0,
      isPastDue: (ymd) => ymd < "2026-08-29",
    });
    expect(kpis.late).toBe(1);
    expect(kpis.notStarted).toBe(1);
  });

  it("caps completion rate at 100", () => {
    expect(
      completionRate({
        scheduled: 10,
        finished: 12,
        notStarted: 0,
        inProgress: 0,
        late: 0,
      }),
    ).toBe(100);
  });

  it("week range starts on monday", () => {
    const { startYmd, endYmd } = overviewPeriodRange(
      "week",
      undefined,
      undefined,
      "2026-08-29",
    );
    expect(startYmd).toBe(spMondayOfWeek("2026-08-29"));
    expect(endYmd >= startYmd).toBe(true);
    expect(endYmd).toBe("2026-08-30");
  });

  it("attributes monthly finishes to the quota day", () => {
    const monthly = {
      recurrence_kind: "monthly" as const,
      daily_executions_per_day: null,
      weekday_mask: 127,
      monthly_executions: 2,
    };
    const ymds = ["2026-08-01", "2026-08-05"];
    const count = new Map([
      ["2026-08-01", 0],
      ["2026-08-05", 1],
    ]);
    expect(finishedAttributedToYmd(monthly, "2026-08-01", ymds, count)).toBe(1);
    expect(finishedAttributedToYmd(monthly, "2026-08-05", ymds, count)).toBe(0);
  });

  it("builds team kpis and ranking from assignments", () => {
    const dash = buildOverviewDashboard({
      kind: "today",
      todayYmd: "2026-08-29",
      assignments: [
        {
          checklistId: "c1",
          checklistTitle: "Abertura",
          memberId: "m1",
          memberName: "Ana",
          meta: dailyAllWeek,
          deadlineOrWindowEnd: null,
        },
      ],
      runs: [
        {
          checklistId: "c1",
          memberId: "m1",
          status: "approved",
          submittedAt: "2026-08-29T15:00:00.000Z",
          on_time: true,
          geofence_ok: true,
          itemsDone: 4,
          itemsTotal: 4,
        },
      ],
    });
    expect(dash.kpis.scheduled).toBe(1);
    expect(dash.kpis.finished).toBe(1);
    expect(dash.ranking).toHaveLength(1);
    expect(dash.ranking[0]?.name).toBe("Ana");
    expect(dash.ranking[0]?.finished).toBe(1);
    expect(dash.ranking[0]?.score).toBe(100);
  });
});

describe("expectedOnYmd", () => {
  it("follows weekday mask", () => {
    expect(expectedOnYmd(dailyAllWeek, "2026-08-29")).toBe(1);
    const weekdaysOnly = { ...dailyAllWeek, weekday_mask: 0b0111110 };
    expect(expectedOnYmd(weekdaysOnly, "2026-08-29")).toBe(0);
  });

  it("places monthly quota on first day of month in range", () => {
    const monthly = {
      recurrence_kind: "monthly" as const,
      daily_executions_per_day: null,
      weekday_mask: 127,
      monthly_executions: 2,
    };
    const ymds = ["2026-08-01", "2026-08-02"];
    expect(expectedOnYmdInRange(monthly, "2026-08-01", ymds)).toBe(2);
    expect(expectedOnYmdInRange(monthly, "2026-08-02", ymds)).toBe(0);
  });
});

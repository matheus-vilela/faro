import { describe, expect, it } from "vitest";
import {
  formatRecurrenceLabel,
  nextRunAfter,
  snapToWeekday,
} from "./scheduleNextRun";

describe("nextRunAfter", () => {
  it("não avança agenda única", () => {
    expect(
      nextRunAfter(new Date("2026-09-04T12:00:00Z"), {
        recurrence_kind: "once",
      }),
    ).toBeNull();
  });

  it("avança N dias", () => {
    const next = nextRunAfter(new Date("2026-09-04T12:00:00Z"), {
      recurrence_kind: "every_n_days",
      interval_days: 3,
    });
    expect(next?.toISOString()).toBe("2026-09-07T12:00:00.000Z");
  });

  it("semana sim / não avança 14 dias", () => {
    const next = nextRunAfter(new Date("2026-09-04T12:00:00Z"), {
      recurrence_kind: "alt_weeks",
      weekday: 5,
    });
    expect(next?.toISOString()).toBe("2026-09-18T12:00:00.000Z");
  });
});

describe("formatRecurrenceLabel", () => {
  it("rotula os três modos", () => {
    expect(formatRecurrenceLabel({ recurrence_kind: "once" })).toBe("Única");
    expect(
      formatRecurrenceLabel({
        recurrence_kind: "every_n_days",
        interval_days: 7,
      }),
    ).toBe("A cada 7 dias");
    expect(
      formatRecurrenceLabel({ recurrence_kind: "alt_weeks", weekday: 1 }),
    ).toBe("Semana sim / semana não · Seg");
  });
});

describe("snapToWeekday", () => {
  it("mantém o dia se já é o weekday", () => {
    const friday = new Date(2026, 8, 4, 10, 0, 0);
    expect(friday.getDay()).toBe(5);
    const snapped = snapToWeekday(friday, 5);
    expect(snapped.getDate()).toBe(4);
  });
});

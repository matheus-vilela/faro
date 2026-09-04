import { describe, expect, it } from "vitest";
import { staffScoreAxes } from "./checklistStaffScore";

describe("checklistStaffScore", () => {
  it("averages prazo/completo/preciso", () => {
    const axes = staffScoreAxes([
      {
        on_time: true,
        items_done: 4,
        items_total: 4,
        needs_rework: false,
        geofence_ok: true,
      },
      {
        on_time: false,
        items_done: 2,
        items_total: 4,
        needs_rework: true,
        geofence_ok: false,
      },
    ]);
    expect(axes.prazo).toBe(70);
    expect(axes.completo).toBe(75);
    expect(axes.preciso).toBe(73);
    expect(axes.score).toBe(Math.round((70 + 75 + 73) / 3));
  });

  it("reaches 100 when on time, complete, and not returned", () => {
    const axes = staffScoreAxes([
      {
        on_time: true,
        items_done: 3,
        items_total: 3,
        needs_rework: false,
      },
    ]);
    expect(axes.prazo).toBe(100);
    expect(axes.completo).toBe(100);
    expect(axes.preciso).toBe(100);
    expect(axes.score).toBe(100);
  });

  it("treats missing deadline as on time", () => {
    const axes = staffScoreAxes([
      {
        on_time: null,
        items_done: 1,
        items_total: 1,
        needs_rework: false,
      },
    ]);
    expect(axes.prazo).toBe(100);
  });
});

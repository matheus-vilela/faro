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
    expect(axes.preciso).toBe(65);
    expect(axes.score).toBe(Math.round((70 + 75 + 65) / 3));
  });
});

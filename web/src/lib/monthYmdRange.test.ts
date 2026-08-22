import { describe, expect, it } from "vitest";
import { monthYmdBounds, orderedYmdRange } from "./monthYmdRange";

describe("monthYmdBounds", () => {
  it("returns first and last day of the month", () => {
    expect(monthYmdBounds(8, 2026)).toEqual({
      min: "2026-08-01",
      max: "2026-08-31",
    });
    expect(monthYmdBounds(2, 2024)).toEqual({
      min: "2024-02-01",
      max: "2024-02-29",
    });
  });
});

describe("orderedYmdRange", () => {
  it("swaps inverted dates", () => {
    expect(orderedYmdRange("2026-08-20", "2026-08-01")).toEqual({
      gte: "2026-08-01",
      lte: "2026-08-20",
    });
  });

  it("keeps already ordered dates", () => {
    expect(orderedYmdRange("2026-08-01", "2026-08-31")).toEqual({
      gte: "2026-08-01",
      lte: "2026-08-31",
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  msUntilNextMinute,
  workerShouldStopForNextTick,
} from "../../../supabase/functions/_shared/nfePipeline/workerSchedule.ts";

describe("msUntilNextMinute", () => {
  it("mede o resto até o próximo minuto civil", () => {
    expect(msUntilNextMinute(60_000)).toBe(60_000);
    expect(msUntilNextMinute(61_000)).toBe(59_000);
    expect(msUntilNextMinute(119_999)).toBe(1);
  });
});

describe("workerShouldStopForNextTick", () => {
  it("no cron para se faltam menos de 10s para o próximo minuto", () => {
    expect(
      workerShouldStopForNextTick({
        alignToCron: true,
        stopBeforeMs: 10_000,
        elapsedMs: 1_000,
        budgetMs: 70_000,
        nowMs: 51_000,
      }),
    ).toBe(true);
    expect(
      workerShouldStopForNextTick({
        alignToCron: true,
        stopBeforeMs: 10_000,
        elapsedMs: 1_000,
        budgetMs: 70_000,
        nowMs: 40_000,
      }),
    ).toBe(false);
  });

  it("manual só respeita o budget, não o minuto civil", () => {
    expect(
      workerShouldStopForNextTick({
        alignToCron: false,
        stopBeforeMs: 10_000,
        elapsedMs: 1_000,
        budgetMs: 70_000,
        nowMs: 55_000,
      }),
    ).toBe(false);
    expect(
      workerShouldStopForNextTick({
        alignToCron: false,
        stopBeforeMs: 10_000,
        elapsedMs: 66_000,
        budgetMs: 70_000,
        nowMs: 10_000,
      }),
    ).toBe(true);
  });
});

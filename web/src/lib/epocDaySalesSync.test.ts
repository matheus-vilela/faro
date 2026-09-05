import { describe, expect, it } from "vitest";
import {
  isEpocDaySalesSyncDateInFuture,
  ymdToEpocConsultaDiaBr,
} from "./epocDaySalesSync";

describe("ymdToEpocConsultaDiaBr", () => {
  it("converte YYYY-MM-DD para dd/MM/aaaa", () => {
    expect(ymdToEpocConsultaDiaBr("2026-08-27")).toBe("27/08/2026");
  });

  it("rejeita datas inválidas", () => {
    expect(ymdToEpocConsultaDiaBr("27/08/2026")).toBeNull();
    expect(ymdToEpocConsultaDiaBr("")).toBeNull();
  });
});

describe("isEpocDaySalesSyncDateInFuture", () => {
  it("bloqueia dia após hoje em São Paulo", () => {
    expect(
      isEpocDaySalesSyncDateInFuture(
        "2026-09-05",
        new Date("2026-09-04T15:00:00-03:00"),
      ),
    ).toBe(true);
  });

  it("permite hoje e o passado", () => {
    const now = new Date("2026-09-04T15:00:00-03:00");
    expect(isEpocDaySalesSyncDateInFuture("2026-09-04", now)).toBe(false);
    expect(isEpocDaySalesSyncDateInFuture("2026-09-03", now)).toBe(false);
  });
});

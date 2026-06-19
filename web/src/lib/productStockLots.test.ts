import { describe, expect, it } from "vitest";
import {
  lotExpiryStatus,
  parseProductStockLots,
  summarizeLotAlerts,
  type ProductStockLotEntry,
} from "./productStockLots";

describe("productStockLots", () => {
  const ref = new Date("2026-06-10T12:00:00");

  it("classifies expiry status", () => {
    expect(lotExpiryStatus("2026-06-01", ref)).toBe("expired");
    expect(lotExpiryStatus("2026-06-12", ref)).toBe("near");
    expect(lotExpiryStatus("2026-06-20", ref)).toBe("ok");
  });

  it("parses stock_lots JSON", () => {
    const lots = parseProductStockLots([
      { id: "a", quantity: 5, expiry_date: "2026-06-20" },
      { quantity: -1, expiry_date: "2026-06-01" },
      { id: "b", quantity: 3, expiry_date: "2026-06-12" },
    ]);
    expect(lots).toHaveLength(2);
    expect(lots[0]!.expiry_date).toBe("2026-06-12");
    expect(lots[1]!.expiry_date).toBe("2026-06-20");
  });

  it("summarizes lot alerts", () => {
    const lots: ProductStockLotEntry[] = [
      {
        id: "1",
        quantity: 10,
        expiry_date: "2026-06-12",
      },
    ];
    const s = summarizeLotAlerts(lots, ref);
    expect(s.hasNearExpiry).toBe(true);
    expect(s.hasExpired).toBe(false);
    expect(s.totalInLots).toBe(10);
  });
});

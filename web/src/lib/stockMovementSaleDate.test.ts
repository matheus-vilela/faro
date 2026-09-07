import { describe, expect, it } from "vitest";
import {
  formatStockMovementListDate,
  sortStockMovementsByEffectiveDate,
  stockMovementSaleDateYmd,
} from "@/lib/stockMovementSaleDate";

describe("stockMovementSaleDateYmd", () => {
  it("lê yyyy-MM-dd do metadata", () => {
    expect(stockMovementSaleDateYmd({ sale_date: "2026-08-15" })).toBe(
      "2026-08-15",
    );
    expect(stockMovementSaleDateYmd({ sale_date: "2026-08-15T12:00:00Z" })).toBe(
      "2026-08-15",
    );
  });

  it("ignora valor inválido", () => {
    expect(stockMovementSaleDateYmd({ sale_date: "ontem" })).toBeNull();
    expect(stockMovementSaleDateYmd(null)).toBeNull();
    expect(stockMovementSaleDateYmd({ sale_date: 15 })).toBeNull();
  });
});

describe("formatStockMovementListDate", () => {
  it("prioriza sale_date e não desloca o dia", () => {
    const formatted = formatStockMovementListDate({
      created_at: "2026-09-07T17:00:00.000Z",
      metadata_json: { sale_date: "2026-08-15" },
    });
    expect(formatted).toMatch(/15/);
    expect(formatted.toLowerCase()).toMatch(/ago/);
    expect(formatted).not.toMatch(/\d{2}:\d{2}/);
  });

  it("cai em created_at sem sale_date", () => {
    const formatted = formatStockMovementListDate({
      created_at: "2026-09-07T15:30:00.000-03:00",
      metadata_json: null,
    });
    expect(formatted).toMatch(/\d{2}:\d{2}/);
  });
});

describe("sortStockMovementsByEffectiveDate", () => {
  it("ordena por sale_date e não por created_at", () => {
    const sorted = sortStockMovementsByEffectiveDate([
      {
        id: "a",
        created_at: "2026-09-07T18:00:00.000Z",
        metadata_json: { sale_date: "2026-08-10" },
      },
      {
        id: "b",
        created_at: "2026-09-07T17:00:00.000Z",
        metadata_json: { sale_date: "2026-08-20" },
      },
      {
        id: "c",
        created_at: "2026-09-06T12:00:00.000Z",
        metadata_json: null,
      },
    ]);
    expect(sorted.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });
});

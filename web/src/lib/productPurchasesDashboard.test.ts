import { describe, expect, it } from "vitest";
import {
  computePurchasesDashboardCounts,
  isCriticalStockProduct,
  isProductWithoutMinStock,
  isProductWithoutPrice,
  isProductWithStalePrice,
  matchesPurchasesMetric,
} from "./productPurchasesDashboard";

const now = new Date("2026-05-21T12:00:00Z").getTime();

function row(
  partial: Partial<{
    min_quantity: number;
    current_quantity: number;
    last_unit_value: number | null;
    last_unit_value_stock: number | null;
    average_cost: number | null;
    updated_at: string;
  }>,
) {
  return {
    min_quantity: 10,
    current_quantity: 5,
    last_unit_value: 2,
    last_unit_value_stock: null,
    average_cost: null,
    updated_at: "2026-05-01T00:00:00Z",
    ...partial,
  };
}

describe("isCriticalStockProduct", () => {
  it("marca quando saldo ≤ 20% do mínimo", () => {
    expect(isCriticalStockProduct(row({ min_quantity: 10, current_quantity: 2 }))).toBe(
      true,
    );
    expect(isCriticalStockProduct(row({ min_quantity: 10, current_quantity: 2.01 }))).toBe(
      false,
    );
  });

  it("ignora sem mínimo configurado", () => {
    expect(isCriticalStockProduct(row({ min_quantity: 0, current_quantity: 0 }))).toBe(
      false,
    );
  });
});

describe("purchases metrics", () => {
  it("sem preço quando não há valor unitário", () => {
    expect(
      isProductWithoutPrice(
        row({
          last_unit_value: null,
          last_unit_value_stock: null,
          average_cost: null,
        }),
      ),
    ).toBe(true);
  });

  it("sem estoque mínimo quando mínimo é zero", () => {
    expect(isProductWithoutMinStock(row({ min_quantity: 0 }))).toBe(true);
  });

  it("preço desatualizado só com preço e updated_at antigo", () => {
    expect(
      isProductWithStalePrice(
        row({ updated_at: "2026-01-01T00:00:00Z" }),
        now,
      ),
    ).toBe(true);
    expect(
      isProductWithStalePrice(
        row({ updated_at: "2026-05-20T00:00:00Z" }),
        now,
      ),
    ).toBe(false);
    expect(
      isProductWithStalePrice(
        row({
          last_unit_value: null,
          average_cost: null,
          last_unit_value_stock: null,
          updated_at: "2026-01-01T00:00:00Z",
        }),
        now,
      ),
    ).toBe(false);
  });

  it("agrega contagens", () => {
    const counts = computePurchasesDashboardCounts(
      [
        row({ min_quantity: 10, current_quantity: 1 }),
        row({ min_quantity: 0, last_unit_value: null, average_cost: null }),
        row({
          min_quantity: 5,
          current_quantity: 5,
          updated_at: "2026-01-01T00:00:00Z",
        }),
      ],
      now,
    );
    expect(counts.criticalStock).toBe(1);
    expect(counts.withoutMinStock).toBe(1);
    expect(counts.withoutPrice).toBe(1);
    expect(counts.stalePrice).toBe(1);
  });

  it("matchesPurchasesMetric filtra por tipo", () => {
    const p = row({ min_quantity: 10, current_quantity: 1 });
    expect(matchesPurchasesMetric(p, "critical", now)).toBe(true);
    expect(matchesPurchasesMetric(p, "no_price", now)).toBe(false);
  });
});

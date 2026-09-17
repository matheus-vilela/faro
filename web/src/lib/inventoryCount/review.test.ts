import { describe, expect, it } from "vitest";
import {
  aggregateCountReview,
  countUnitCost,
  countVariationPct,
} from "./review";

describe("countUnitCost", () => {
  it("prefere custo médio e cai no último preço", () => {
    expect(countUnitCost({ average_cost: 12, last_unit_value: 9 })).toBe(12);
    expect(countUnitCost({ average_cost: null, last_unit_value: 4.5 })).toBe(4.5);
    expect(countUnitCost({})).toBe(0);
  });
});

describe("aggregateCountReview", () => {
  it("soma pontos do mesmo SKU e pesa o impacto pelo custo", () => {
    const rows = aggregateCountReview({
      lines: [
        {
          id: "l1",
          product_id: "heineken",
          expected_qty: 100,
          counted_qty: 40,
          tolerance_pct: 5,
          listing_id: "a",
          listing_name: "Câmara",
          group_name: "Câmara Fria",
          product_name: "Heineken",
          product_unit: "un",
          average_cost: 8,
        },
        {
          id: "l2",
          product_id: "heineken",
          expected_qty: 100,
          counted_qty: 55,
          tolerance_pct: 5,
          listing_id: "b",
          listing_name: "Balcão",
          group_name: "Bar 1",
          product_name: "Heineken",
          product_unit: "un",
          average_cost: 8,
        },
      ],
      requiredPoints: [
        {
          productId: "heineken",
          listingId: "a",
          listingName: "Câmara",
          groupName: "Câmara Fria",
        },
        {
          productId: "heineken",
          listingId: "b",
          listingName: "Balcão",
          groupName: "Bar 1",
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].countedQty).toBe(95);
    expect(rows[0].expectedQty).toBe(100);
    expect(rows[0].impact).toBe(40);
    expect(rows[0].updatesStock).toBe(true);
    expect(countVariationPct(100, 95)).toBe(-5);
  });

  it("não atualiza estoque se falta um ponto da empresa", () => {
    const rows = aggregateCountReview({
      lines: [
        {
          id: "l1",
          product_id: "heineken",
          expected_qty: 20,
          counted_qty: 10,
          tolerance_pct: 5,
          listing_id: "a",
          listing_name: "Balcão",
          group_name: "Bar 1",
          product_name: "Heineken",
          product_unit: "un",
          last_unit_value: 8,
        },
      ],
      requiredPoints: [
        {
          productId: "heineken",
          listingId: "a",
          listingName: "Balcão",
          groupName: "Bar 1",
        },
        {
          productId: "heineken",
          listingId: "c",
          listingName: "Geladeira",
          groupName: "Câmara Fria",
        },
      ],
    });
    expect(rows[0].updatesStock).toBe(false);
    expect(rows[0].missingPoints).toEqual([
      { listingName: "Geladeira", groupName: "Câmara Fria" },
    ]);
  });
});

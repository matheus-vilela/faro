import { describe, expect, it } from "vitest";
import {
  applyStockMovementClassificationFilter,
  movementClassificationDisplayLabel,
  resolveMovementClassificationFilterKey,
} from "./stockMovementClassification";
import {
  applyStockMovementDirectionFilter,
  isWasteStockMovement,
  stockMovementTypeLabel,
} from "./stockMovementFilters";

describe("stockMovementFilters", () => {
  it("identifies waste movements", () => {
    expect(isWasteStockMovement({ type: "waste", reference_type: "waste" })).toBe(
      true,
    );
    expect(isWasteStockMovement({ type: "out", reference_type: "waste" })).toBe(
      true,
    );
    expect(isWasteStockMovement({ type: "out", reference_type: "expense_item" })).toBe(
      false,
    );
  });

  it("labels movement direction as entrada or saída", () => {
    expect(stockMovementTypeLabel({ type: "in", reference_type: null })).toBe(
      "Entrada",
    );
    expect(
      stockMovementTypeLabel({ type: "waste", reference_type: "waste" }),
    ).toBe("Saída");
    expect(
      stockMovementTypeLabel({ type: "out", reference_type: "revenue_entry" }),
    ).toBe("Saída");
  });

  it("applies direction filters on query builders", () => {
    const calls: string[] = [];
    const query = {
      eq(column: string, value: string) {
        calls.push(`eq:${column}:${value}`);
        return this;
      },
      or(filters: string) {
        calls.push(`or:${filters}`);
        return this;
      },
    };

    applyStockMovementDirectionFilter(query, "all");
    expect(calls).toEqual([]);

    applyStockMovementDirectionFilter(query, "in");
    expect(calls).toContain("eq:type:in");

    applyStockMovementDirectionFilter(query, "out");
    expect(calls).toContain("or:type.eq.out,type.eq.waste");
  });
});

describe("stockMovementClassification", () => {
  it("shows despesa/venda defaults and ref fallback", () => {
    expect(
      movementClassificationDisplayLabel({
        type: "in",
        reference_type: "expense_item",
      }),
    ).toBe("Despesa");
    expect(
      movementClassificationDisplayLabel({
        type: "out",
        reference_type: "revenue_entry",
      }),
    ).toBe("Venda");
    expect(
      movementClassificationDisplayLabel({
        type: "in",
        reference_type: null,
        metadata_json: { classification: "purchase" },
      }),
    ).toBe("Despesa");
    expect(
      movementClassificationDisplayLabel({
        type: "in",
        reference_type: null,
      }),
    ).toBe("Despesa");
    expect(
      movementClassificationDisplayLabel({
        type: "out",
        reference_type: null,
      }),
    ).toBe("Venda");
    expect(
      movementClassificationDisplayLabel({
        type: "in",
        reference_type: "inventory_count",
      }),
    ).toBe("Contagem");
  });

  it("resolves filter keys", () => {
    expect(
      resolveMovementClassificationFilterKey({
        type: "in",
        reference_type: "expense_item",
      }),
    ).toBe("expense");
    expect(
      resolveMovementClassificationFilterKey({
        type: "out",
        reference_type: null,
        metadata_json: { classification: "sale" },
      }),
    ).toBe("sale");
  });

  it("applies classification filters on query builders", () => {
    const calls: string[] = [];
    const query = {
      eq() {
        return this;
      },
      or(filters: string) {
        calls.push(filters);
        return this;
      },
    };

    applyStockMovementClassificationFilter(query, "expense");
    expect(calls[0]).toContain("reference_type.eq.expense_item");
    expect(calls[0]).toContain("classification.eq.purchase");

    applyStockMovementClassificationFilter(query, "loss");
    expect(calls[1]).toContain("type.eq.waste");
  });
});

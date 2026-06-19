import { describe, expect, it } from "vitest";
import {
  computeManualMovementDelta,
  convertUnitPriceToStockUnit,
  isManuallyRegisteredStockMovement,
  manualClassificationLabel,
  manualStockMovementRegisteredByLabel,
} from "./manualStockMovement";

describe("manualStockMovement", () => {
  it("computes delta by movement kind", () => {
    expect(computeManualMovementDelta("entry", 5, 5)).toBe(5);
    expect(computeManualMovementDelta("exit", 5, 5)).toBe(-5);
    expect(computeManualMovementDelta("inventory", 3, 3)).toBe(3);
    expect(computeManualMovementDelta("inventory", -2, 2)).toBe(-2);
  });

  it("converts unit price to stock unit", () => {
    expect(convertUnitPriceToStockUnit(10, 2, 2000)).toBeCloseTo(0.01);
    expect(convertUnitPriceToStockUnit(10, 0, 1)).toBeNull();
  });

  it("labels classifications", () => {
    expect(manualClassificationLabel("purchase")).toBe("Despesa");
    expect(manualClassificationLabel("loss")).toBe("Perda");
    expect(manualClassificationLabel("unknown")).toBe("unknown");
  });

  it("detects manual registration and registered by name", () => {
    expect(isManuallyRegisteredStockMovement({})).toBe(false);
    expect(
      isManuallyRegisteredStockMovement({ registration_mode: "single" }),
    ).toBe(true);
    expect(
      isManuallyRegisteredStockMovement({ registration_mode: "batch" }),
    ).toBe(true);
    expect(
      manualStockMovementRegisteredByLabel({
        registration_mode: "single",
        registered_by_name: "Maria Silva",
      }),
    ).toBe("Maria Silva");
    expect(
      manualStockMovementRegisteredByLabel({
        registration_mode: "batch",
        registered_by_name: "João",
      }),
    ).toBe("João");
  });
});

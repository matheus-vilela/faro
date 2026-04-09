import { describe, expect, it } from "vitest";
import { canonicalProductName, normalizeInvoiceProductLabel } from "./canonicalName";
import { consolidateInvoiceItems, pickInvoiceUnitRaw } from "./consolidateItems";
import { applySecondarySignals, scoreNameMatch } from "./matchingScore";
import { clampThresholds } from "./matchConfig";
import {
  conversionFactorToA,
  normalizeUnitLabel,
  unitsAreConvertible,
} from "./unitNormalize";

describe("unitNormalize", () => {
  it("maps common aliases to codes", () => {
    expect(normalizeUnitLabel("KG")).toBe("KG");
    expect(normalizeUnitLabel("quilo")).toBe("KG");
    expect(normalizeUnitLabel("UN")).toBe("UND");
    expect(normalizeUnitLabel("Sachê")).toBe("SACHE");
  });

  it("detects convertible mass and volume", () => {
    expect(unitsAreConvertible("KG", "G")).toBe(true);
    expect(unitsAreConvertible("L", "ML")).toBe(true);
    expect(unitsAreConvertible("UND", "CX")).toBe(false);
  });

  it("gives conversion factors between kg and g", () => {
    expect(conversionFactorToA("G", "KG")).toBe(1000);
    expect(conversionFactorToA("KG", "G")).toBe(0.001);
  });
});

describe("canonicalName", () => {
  it("normalizes invoice label", () => {
    expect(normalizeInvoiceProductLabel("  Maionese!!  ")).toBe("maionese");
  });

  it("builds stable canonical tokens", () => {
    expect(canonicalProductName("Batata Inglesa")).toContain("batata");
  });
});

describe("matchingScore", () => {
  it("scores identical names at 100", () => {
    expect(scoreNameMatch("Maionese", "Maionese")).toBe(100);
  });

  it("boosts score on matching EAN", () => {
    const r = applySecondarySignals({
      baseScore: 70,
      invoiceEan: "7891234567890",
      productBarcode: "7891234567890",
    });
    expect(r.score).toBeGreaterThan(85);
    expect(r.reasons.length).toBeGreaterThan(0);
  });
});

describe("consolidateInvoiceItems", () => {
  it("merges same canonical line and unit", () => {
    const merged = consolidateInvoiceItems([
      {
        productName: "Batata",
        quantity: 2,
        unitValue: 10,
        lineTotal: 20,
        unitCommercial: "KG",
      },
      {
        productName: "Batata",
        quantity: 2,
        unitValue: 10,
        lineTotal: 20,
        unitCommercial: "KG",
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.quantity).toBe(4);
    expect(merged[0]?.lineTotal).toBe(40);
  });

  it("pickInvoiceUnitRaw prefers explicit invoice unit", () => {
    expect(
      pickInvoiceUnitRaw({
        productName: "x",
        quantity: 1,
        unitValue: 1,
        lineTotal: 1,
        invoiceUnitRaw: "CX",
        unitCommercial: "KG",
      }),
    ).toBe("CX");
  });
});

describe("matchConfig", () => {
  it("keeps confirm score <= auto score", () => {
    const t = clampThresholds({ autoMatchMinScore: 80, confirmMinScore: 90 });
    expect(t.confirmMinScore).toBeLessThanOrEqual(t.autoMatchMinScore);
    expect(t.autoMatchMinScore).toBe(80);
    expect(t.confirmMinScore).toBe(80);
  });
});

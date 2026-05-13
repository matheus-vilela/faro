import { describe, expect, it } from "vitest";
import { canonicalProductName, normalizeInvoiceProductLabel, stripTrailingPackagingQtyAndUnitsForCatalogName } from "./canonicalName";
import { consolidateInvoiceItems, pickInvoiceUnitRaw } from "./consolidateItems";
import {
  applySecondarySignals,
  isFlavorOnlyCatalogInsideCompositeInvoice,
  scoreNameMatch,
  shortCatalogAnchorsInvoiceHead,
} from "./matchingScore";
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

  it("does not over-score refrigerante+sabor vs só fruta no cadastro", () => {
    expect(isFlavorOnlyCatalogInsideCompositeInvoice("Refrigerante de Morango", "Morango")).toBe(
      true,
    );
    const s = scoreNameMatch("Refrigerante de Morango", "Morango");
    expect(s).toBeLessThan(80);
  });

  it("keeps strong score for arroz vs arroz branco (sem token de bebida)", () => {
    expect(isFlavorOnlyCatalogInsideCompositeInvoice("Arroz Branco Tipo 1", "Arroz")).toBe(false);
    expect(scoreNameMatch("Arroz Branco Tipo 1", "Arroz")).toBeGreaterThanOrEqual(80);
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

  it("does not push NCM to high floor when lexical name score is low", () => {
    const r = applySecondarySignals({
      baseScore: 28,
      invoiceNcm: "07119000",
      productNcm: "07119000",
    });
    expect(r.score).toBeLessThan(88);
    expect(r.score).toBe(38);
  });

  it("keeps strong NCM floor when base name score is already solid", () => {
    const r = applySecondarySignals({
      baseScore: 62,
      invoiceNcm: "21032010",
      productNcm: "21032010",
    });
    expect(r.score).toBeGreaterThanOrEqual(88);
  });

  it("penalizes short catalog name that only matches a tail token in a long invoice line", () => {
    const s = scoreNameMatch(
      "PANO BOBINA MULTIUSO 28X240MTS LARANJA INOVEN",
      "Laranja",
    );
    expect(s).toBeLessThanOrEqual(58);
  });

  it("shortCatalogAnchorsInvoiceHead is true when catalog tokens prefix the invoice", () => {
    expect(shortCatalogAnchorsInvoiceHead("Arroz Branco Tipo 1", "Arroz")).toBe(true);
  });
});

describe("canonicalName — strip sufixo embalagem/unidade", () => {
  it("remove quantidade + unidades no fim (canudo)", () => {
    expect(
      stripTrailingPackagingQtyAndUnitsForCatalogName(
        "Canudo de Papel 6mm Golden 100 Unidades",
      ),
    ).toBe("Canudo de Papel 6mm Golden");
  });

  it("remove 100 UN no fim", () => {
    expect(stripTrailingPackagingQtyAndUnitsForCatalogName("Canudo 6mm Golden 100 UN")).toBe(
      "Canudo 6mm Golden",
    );
  });

  it("não remove dimensão colada ao token (6mm)", () => {
    expect(stripTrailingPackagingQtyAndUnitsForCatalogName("Canudo Papel 6mm")).toBe(
      "Canudo Papel 6mm",
    );
  });

  it("remove kg no fim", () => {
    expect(stripTrailingPackagingQtyAndUnitsForCatalogName("Açúcar Cristal 5 kg")).toBe(
      "Açúcar Cristal",
    );
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

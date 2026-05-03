import { describe, expect, it } from "vitest";
import { applyCompanyUnitAlias } from "../../../../supabase/functions/_shared/productImport/unitNormalize.ts";
import { mapInvoiceUnitToCatalogUnit } from "../../../../supabase/functions/_shared/productImport/invoiceUnitToCatalogUnit.ts";

describe("mapInvoiceUnitToCatalogUnit (paridade import batch / assist)", () => {
  it("PCT e pacote -> pct", () => {
    expect(mapInvoiceUnitToCatalogUnit("PCT")).toMatchObject({
      unit: "pct",
      needsReview: false,
    });
    expect(mapInvoiceUnitToCatalogUnit("pacote")).toMatchObject({
      unit: "pct",
      needsReview: false,
    });
  });

  it("FD e fardo -> fd", () => {
    expect(mapInvoiceUnitToCatalogUnit("FD")).toMatchObject({
      unit: "fd",
      needsReview: false,
    });
    expect(mapInvoiceUnitToCatalogUnit("fardo")).toMatchObject({
      unit: "fd",
      needsReview: false,
    });
  });

  it("vazio -> un com revisão", () => {
    expect(mapInvoiceUnitToCatalogUnit("")).toMatchObject({
      unit: "un",
      needsReview: true,
      rawUnit: null,
    });
  });

  it("UNI -> un sem revisão", () => {
    expect(mapInvoiceUnitToCatalogUnit("UNI")).toMatchObject({
      unit: "un",
      needsReview: false,
    });
  });

  it("alias empresa antes do map", () => {
    const aliasMap = new Map<string, string>([["pct", "embx"]]);
    const raw = "PCT";
    const after = applyCompanyUnitAlias(raw, aliasMap) ?? raw;
    expect(after).toBe("embx");
    expect(mapInvoiceUnitToCatalogUnit(after)).toMatchObject({
      unit: "embx",
      needsReview: true,
    });
  });
});

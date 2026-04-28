import { describe, expect, it } from "vitest";
import { mapInvoiceUnitRawToProductUnit } from "./onboardingCatalogReconciliationService";

describe("mapInvoiceUnitRawToProductUnit", () => {
  it("maps aliases and defaults", () => {
    expect(mapInvoiceUnitRawToProductUnit("CX").unit).toBe("cx");
    expect(mapInvoiceUnitRawToProductUnit("cx").needsReview).toBe(false);
    expect(mapInvoiceUnitRawToProductUnit(null).unit).toBe("un");
    expect(mapInvoiceUnitRawToProductUnit(null).needsReview).toBe(true);
  });
});

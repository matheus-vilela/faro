import { describe, expect, it } from "vitest";
import {
  computeStockQuantity,
  pickProductUnitRule,
  type ProductUnitRuleRow,
} from "./unitConversion";

describe("computeStockQuantity", () => {
  it("DIRECT_UNIT_MATCH when invoice and catalog units match", () => {
    const r = computeStockQuantity({
      invoiceQuantity: 2.8,
      invoiceUnit: "KG",
      productUnitRaw: "kg",
      autoApplyGlobalMassVolume: false,
      productRule: null,
    });
    expect(r.resolutionSource).toBe("DIRECT_UNIT_MATCH");
    expect(r.stockQuantity).toBe(2.8);
    expect(r.conversionFactorApplied).toBe(1);
    expect(r.needsUserConfirmation).toBe(false);
  });

  it("AUTO_CONVERTED_GLOBAL_RULE when G→KG and flag enabled", () => {
    const r = computeStockQuantity({
      invoiceQuantity: 2800,
      invoiceUnit: "G",
      productUnitRaw: "kg",
      autoApplyGlobalMassVolume: true,
      productRule: null,
    });
    expect(r.resolutionSource).toBe("AUTO_CONVERTED_GLOBAL_RULE");
    expect(r.stockQuantity).toBe(2.8);
    expect(r.needsUserConfirmation).toBe(false);
  });

  it("requires confirmation for global conversion when flag off", () => {
    const r = computeStockQuantity({
      invoiceQuantity: 2800,
      invoiceUnit: "G",
      productUnitRaw: "kg",
      autoApplyGlobalMassVolume: false,
      productRule: null,
    });
    expect(r.resolutionSource).toBe("AUTO_CONVERTED_GLOBAL_RULE");
    expect(r.needsUserConfirmation).toBe(true);
  });

  it("AUTO_CONVERTED_PRODUCT_RULE when rule auto_apply without confirmation", () => {
    const rule: ProductUnitRuleRow = {
      from_unit_normalized: "SACHE",
      to_unit_normalized: "KG",
      conversion_factor: 0.5,
      auto_apply: true,
      requires_confirmation: false,
    };
    const r = computeStockQuantity({
      invoiceQuantity: 10,
      invoiceUnit: "SACHE",
      productUnitRaw: "kg",
      autoApplyGlobalMassVolume: false,
      productRule: rule,
    });
    expect(r.resolutionSource).toBe("AUTO_CONVERTED_PRODUCT_RULE");
    expect(r.stockQuantity).toBe(5);
    expect(r.needsUserConfirmation).toBe(false);
  });

  it("pickProductUnitRule selects matching row", () => {
    const rules: ProductUnitRuleRow[] = [
      {
        from_unit_normalized: "G",
        to_unit_normalized: "KG",
        conversion_factor: 0.001,
        auto_apply: true,
        requires_confirmation: false,
      },
    ];
    expect(pickProductUnitRule(rules, "G", "KG")).toBe(rules[0]);
    expect(pickProductUnitRule(rules, "ML", "L")).toBeNull();
  });
});

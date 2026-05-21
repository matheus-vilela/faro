import { assertEquals } from "jsr:@std/assert@1";
import {
  buildCommercialTaxUnitConversion,
  nfeCommercialAndTaxUnitsDiffer,
} from "./nfeCommercialTaxUnitConversion.ts";
import { buildNewProductCatalogFromNfeLine } from "./buildPackUnitConversionsFromLabel.ts";

Deno.test("nfeCommercialAndTaxUnitsDiffer: CX vs UN", () => {
  assertEquals(nfeCommercialAndTaxUnitsDiffer("CX", "UN"), true);
  assertEquals(nfeCommercialAndTaxUnitsDiffer("UN", "UN"), false);
});

Deno.test("buildCommercialTaxUnitConversion: 2 CX com 48 UN", () => {
  const r = buildCommercialTaxUnitConversion({
    unitCommercial: "CX",
    unitTax: "UN",
    quantityCommercial: 2,
    quantityTax: 48,
  });
  assertEquals(r != null, true);
  assertEquals(r!.stockUnit, "cx");
  assertEquals(r!.conversions[0]!.secondary_qty, 24);
  assertEquals(r!.conversions[0]!.secondary_unit_code, "un");
});

Deno.test("buildNewProductCatalogFromNfeLine: uCom CX + uTrib UN", () => {
  const r = buildNewProductCatalogFromNfeLine({
    productName: "Refrigerante",
    invoiceUnitRaw: "CX",
    unitCommercial: "CX",
    unitTax: "UN",
    quantityCommercial: 1,
    quantityTax: 12,
  });
  assertEquals(r.stockUnit, "cx");
  const toUn = r.conversions.find((c) => c.secondary_unit_code === "un");
  assertEquals(toUn?.secondary_qty, 12);
});

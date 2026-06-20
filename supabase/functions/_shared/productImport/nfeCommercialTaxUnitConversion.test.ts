import { assertEquals } from "jsr:@std/assert@1";
import {
  buildCommercialTaxUnitConversion,
  nfeCommercialAndTaxUnitsDiffer,
  nfeUsesUnTaxUnitBase,
} from "./nfeCommercialTaxUnitConversion.ts";
import { buildNewProductCatalogFromNfeLine } from "./buildPackUnitConversionsFromLabel.ts";

Deno.test("nfeCommercialAndTaxUnitsDiffer: CX vs UN", () => {
  assertEquals(nfeCommercialAndTaxUnitsDiffer("CX", "UN"), true);
  assertEquals(nfeCommercialAndTaxUnitsDiffer("UN", "UN"), false);
});

Deno.test("nfeUsesUnTaxUnitBase: PAC com uTrib UN", () => {
  assertEquals(nfeUsesUnTaxUnitBase("PAC", "UN"), true);
  assertEquals(nfeUsesUnTaxUnitBase("KG", "G"), false);
});

Deno.test("buildCommercialTaxUnitConversion: 2 CX com 48 UN → estoque un", () => {
  const r = buildCommercialTaxUnitConversion({
    unitCommercial: "CX",
    unitTax: "UN",
    quantityCommercial: 2,
    quantityTax: 48,
  });
  assertEquals(r != null, true);
  assertEquals(r!.stockUnit, "un");
  assertEquals(r!.conversions[0]!.primary_unit_code, "un");
  assertEquals(r!.conversions[0]!.primary_qty, 24);
  assertEquals(r!.conversions[0]!.secondary_unit_code, "cx");
  assertEquals(r!.conversions[0]!.secondary_qty, 1);
});

Deno.test("buildCommercialTaxUnitConversion: PAC + UN → 12 un = 1 pct", () => {
  const r = buildCommercialTaxUnitConversion({
    unitCommercial: "PAC",
    unitTax: "UN",
    quantityCommercial: 1,
    quantityTax: 12,
  });
  assertEquals(r!.stockUnit, "un");
  assertEquals(r!.conversions[0]!.primary_qty, 12);
  assertEquals(r!.conversions[0]!.secondary_unit_code, "pct");
});

Deno.test("buildNewProductCatalogFromNfeLine: uCom CX + uTrib UN → estoque un", () => {
  const r = buildNewProductCatalogFromNfeLine({
    productName: "Refrigerante",
    invoiceUnitRaw: "CX",
    unitCommercial: "CX",
    unitTax: "UN",
    quantityCommercial: 1,
    quantityTax: 12,
  });
  assertEquals(r.stockUnit, "un");
  const toCx = r.conversions.find((c) => c.secondary_unit_code === "cx");
  assertEquals(toCx?.primary_unit_code, "un");
  assertEquals(toCx?.primary_qty, 12);
  assertEquals(toCx?.secondary_qty, 1);
});

import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildNewProductCatalogFromNfeLine,
  detectCompositePackMeasure,
} from "./buildPackUnitConversionsFromLabel.ts";

Deno.test("detectCompositePackMeasure: 10x1kg", () => {
  const c = detectCompositePackMeasure("AÇUCAR 10X1KG");
  assertEquals(c?.outer_count, 10);
  assertEquals(c?.inner_unit, "KG");
  assertEquals(c?.total_per_pack, 10);
});

Deno.test("buildNewProductCatalogFromNfeLine: fardo + 10x1kg → fd, 10 un e kg/g/mg", () => {
  const r = buildNewProductCatalogFromNfeLine({
    productName: "AÇUCAR 10X1KG",
    invoiceUnitRaw: "FD",
  });
  assertEquals(r.stockUnit, "fd");
  assertEquals(r.catalogName, "AÇUCAR");
  const un = r.conversions.find((c) => c.secondary_unit_code === "un");
  assertEquals(un?.primary_unit_code, "fd");
  assertEquals(un?.secondary_qty, 10);
  const codes = r.conversions.map((c) => c.secondary_unit_code).sort();
  assertEquals(codes.includes("kg"), true);
  assertEquals(codes.includes("g"), true);
  assertEquals(codes.includes("mg"), true);
  const kg = r.conversions.find((c) => c.secondary_unit_code === "kg");
  assertEquals(kg?.primary_unit_code, "fd");
  assertEquals(kg?.secondary_qty, 10);
  const g = r.conversions.find((c) => c.secondary_unit_code === "g");
  assertEquals(g?.secondary_qty, 10000);
});

Deno.test("buildNewProductCatalogFromNfeLine: cx + 6x500ml → 6 un e volume", () => {
  const r = buildNewProductCatalogFromNfeLine({
    productName: "REFRIG 6X500ML",
    invoiceUnitRaw: "CX",
  });
  const un = r.conversions.find((c) => c.secondary_unit_code === "un");
  assertEquals(un?.primary_unit_code, "cx");
  assertEquals(un?.secondary_qty, 6);
  assertEquals(r.conversions.some((c) => c.secondary_unit_code === "l"), true);
});

Deno.test("buildNewProductCatalogFromNfeLine: 24un no nome → 1 cx = 24 un", () => {
  const r = buildNewProductCatalogFromNfeLine({
    productName: "CERVEJA HEINEKEN 24UN",
    invoiceUnitRaw: "caixa",
  });
  const un = r.conversions.find((c) => c.secondary_unit_code === "un");
  assertEquals(un?.primary_unit_code, "cx");
  assertEquals(un?.secondary_qty, 24);
});

Deno.test("buildNewProductCatalogFromNfeLine: nome limpo sem 10x1kg", () => {
  const r = buildNewProductCatalogFromNfeLine({
    productName: "AÇUCAR CARAVELAS 10X1KG",
    invoiceUnitRaw: "fardo",
  });
  assertEquals(r.catalogName, "AÇUCAR CARAVELAS");
  assertEquals(r.stockUnit, "fd");
});

Deno.test("buildNewProductCatalogFromNfeLine: cx + 12un + 500ml → 12 un, 6 l e 6000 ml", () => {
  const r = buildNewProductCatalogFromNfeLine({
    productName: "AGUA MINERAL 500ML 12UN",
    invoiceUnitRaw: "CX",
  });
  const un = r.conversions.find((c) => c.secondary_unit_code === "un");
  assertEquals(un?.secondary_qty, 12);
  const l = r.conversions.find((c) => c.secondary_unit_code === "l");
  assertEquals(l?.secondary_qty, 6);
  const ml = r.conversions.find((c) => c.secondary_unit_code === "ml");
  assertEquals(ml?.secondary_qty, 6000);
});

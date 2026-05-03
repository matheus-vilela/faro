import { assertEquals } from "jsr:@std/assert@1";
import { applyCompanyUnitAlias } from "./unitNormalize.ts";
import { mapInvoiceUnitToCatalogUnit } from "./invoiceUnitToCatalogUnit.ts";

Deno.test("mapInvoiceUnitToCatalogUnit: PCT e pacote -> pct", () => {
  const a = mapInvoiceUnitToCatalogUnit("PCT");
  assertEquals(a.unit, "pct");
  assertEquals(a.needsReview, false);
  assertEquals(a.rawUnit, "PCT");
  const b = mapInvoiceUnitToCatalogUnit("pacote");
  assertEquals(b.unit, "pct");
  assertEquals(b.needsReview, false);
});

Deno.test("mapInvoiceUnitToCatalogUnit: fd e fardo -> fd", () => {
  const a = mapInvoiceUnitToCatalogUnit("FD");
  assertEquals(a.unit, "fd");
  assertEquals(a.needsReview, false);
  const b = mapInvoiceUnitToCatalogUnit("fardo");
  assertEquals(b.unit, "fd");
});

Deno.test("mapInvoiceUnitToCatalogUnit: vazio -> un com revisão", () => {
  const a = mapInvoiceUnitToCatalogUnit("");
  assertEquals(a.unit, "un");
  assertEquals(a.needsReview, true);
  assertEquals(a.rawUnit, null);
});

Deno.test("mapInvoiceUnitToCatalogUnit: desconhecido preserva slug", () => {
  const a = mapInvoiceUnitToCatalogUnit("ROLO");
  assertEquals(a.needsReview, true);
  assertEquals(a.rawUnit, "ROLO");
  assertEquals(a.unit, "rolo");
});

Deno.test("alias empresa + map: PCT mapeado para unit_code custom", () => {
  const aliasMap = new Map<string, string>([["pct", "embx"]]);
  const raw = "PCT";
  const after = applyCompanyUnitAlias(raw, aliasMap) ?? raw;
  const mapped = mapInvoiceUnitToCatalogUnit(after);
  assertEquals(after, "embx");
  assertEquals(mapped.unit, "embx");
  assertEquals(mapped.needsReview, true);
});

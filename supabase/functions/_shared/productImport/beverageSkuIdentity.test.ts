import { assert, assertEquals } from "jsr:@std/assert";
import {
  beverageSkuVolumeConflict,
  extractBeverageVolumeMl,
  isBeverageSkuLine,
} from "./beverageSkuIdentity.ts";

Deno.test("isBeverageSkuLine: cerveja com marca", () => {
  assert(isBeverageSkuLine("DRAFT BEER HEINEKEN 50L"));
  assert(isBeverageSkuLine("HEINEKEN 0,33LT"));
  assert(isBeverageSkuLine("HEINEKEN 0,6GFA"));
});

Deno.test("extractBeverageVolumeMl: volumes distintos Heineken", () => {
  assertEquals(extractBeverageVolumeMl("DRAFT BEER HEINEKEN 50L"), 50_000);
  assertEquals(extractBeverageVolumeMl("HEINEKEN 0,33LT"), 330);
  assertEquals(extractBeverageVolumeMl("HEINEKEN 0,6GFA"), 600);
});

Deno.test("beverageSkuVolumeConflict: mesma marca volumes diferentes", () => {
  assert(beverageSkuVolumeConflict("HEINEKEN 0,33LT", "HEINEKEN 0,6GFA"));
  assert(beverageSkuVolumeConflict("HEINEKEN 0,33LT", "DRAFT BEER HEINEKEN 50L"));
  assert(!beverageSkuVolumeConflict("HEINEKEN 0,33LT", "HEINEKEN 0,33 LT"));
});

Deno.test("beverageSkuVolumeConflict: insumo alimentar ignorado", () => {
  assert(!beverageSkuVolumeConflict("ARROZ BRANCO TIPO 1 5KG", "ARROZ BRANCO 1KG"));
});

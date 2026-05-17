import { assertEquals } from "jsr:@std/assert";
import { sanitizeCatalogProductName } from "./canonicalName.ts";

Deno.test("sanitizeCatalogProductName — água mineral sem gás → SEM GAS", () => {
  assertEquals(sanitizeCatalogProductName("AGUA MINERAL"), "AGUA MINERAL SEM GAS");
  assertEquals(
    sanitizeCatalogProductName("Água Mineral Crystal"),
    "AGUA MINERAL CRYSTAL SEM GAS",
  );
});

Deno.test("sanitizeCatalogProductName — Heineken 0,0% só marca/variante", () => {
  assertEquals(
    sanitizeCatalogProductName("CERV HEINEKEN 0,0% 0,330GFA DES 4X6UNPBR"),
    "CERVEJA HEINEKEN 0,0%",
  );
});

Deno.test("sanitizeCatalogProductName — água mineral com gás preservada", () => {
  assertEquals(
    sanitizeCatalogProductName("AGUA MINERAL COM GAS"),
    "AGUA MINERAL COM GAS",
  );
  assertEquals(
    sanitizeCatalogProductName("AGUA MINERAL SEM GAS"),
    "AGUA MINERAL SEM GAS",
  );
});

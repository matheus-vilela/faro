import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  catalogMatchNameKey,
  findCatalogProductByNormalizedName,
  findDirectMatchByNcmAndName,
} from "./llmCatalogCandidates.ts";

Deno.test("catalogMatchNameKey: acento e caixa equivalentes", () => {
  assertEquals(catalogMatchNameKey("ÁGUA COM GÁS"), catalogMatchNameKey("AGUA COM GAS"));
});

Deno.test("findCatalogProductByNormalizedName: vincula nome IA ao cadastro existente", () => {
  const catalog = [
    { id: "p1", name: "AGUA COM GAS" },
    { id: "p2", name: "CERVEJA HEINEKEN" },
  ];
  const hit = findCatalogProductByNormalizedName(catalog, "ÁGUA COM GÁS");
  assertEquals(hit?.id, "p1");
});

Deno.test("findDirectMatchByNcmAndName: NCM + nome sem acento", () => {
  const catalog = [
    { id: "p1", name: "AGUA COM GAS", ncm: "22011000" },
  ];
  const hit = findDirectMatchByNcmAndName(
    catalog,
    "22011000",
    "ÁGUA COM GÁS",
  );
  assertEquals(hit?.id, "p1");
});

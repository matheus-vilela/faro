import {
  classifyEpocProductKindHeuristic,
  needsEpocProductKindOpenAi,
} from "./epocCsvProductKindClassification.ts";
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("heuristic: cachaça e Heineken são PRODUCT", () => {
  assertEquals(classifyEpocProductKindHeuristic("Cachaça 51").kind, "PRODUCT");
  assertEquals(
    classifyEpocProductKindHeuristic("Cerveja Heineken Long Neck").kind,
    "PRODUCT",
  );
});

Deno.test("heuristic: caipirinha e balde são RECIPE", () => {
  assertEquals(classifyEpocProductKindHeuristic("Caipirinha").kind, "RECIPE");
  assertEquals(
    classifyEpocProductKindHeuristic("Balde de Cerveja").kind,
    "RECIPE",
  );
});

Deno.test("heuristic: confiança alta não pede OpenAI", () => {
  const c = classifyEpocProductKindHeuristic("Caipirinha");
  assertEquals(c.kind, "RECIPE");
  assertEquals(needsEpocProductKindOpenAi(c), false);
});

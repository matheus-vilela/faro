import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyRevenueCategoryHeuristic,
  isPaymentMethodCategoryName,
  isUsableCachedSaleLeaf,
  pickDefaultRevenueLeaf,
  resolveEpocGrupoCatalogName,
  type RevenueOperationalLeaf,
} from "./epocCsvRevenueClassification.ts";

function leaf(
  id: string,
  name: string,
  parent_id: string | null = "op",
  ordem = 0,
): RevenueOperationalLeaf {
  return { id, name, parent_id, ordem };
}

const EULALIA_BEFORE: RevenueOperationalLeaf[] = [
  leaf("adi", "Adiantamento de Clientes", "outras", 0),
  leaf("din", "Dinheiro", "op", 0),
  leaf("res", "Reservas e eventos", "op", 1),
  leaf("pix", "Venda Pix", "op", 7),
  leaf("vr", "VR / Alelo", "op", 8),
  leaf("pixepoc", "Pix Epoc", "op", 9),
];

const EULALIA_AFTER: RevenueOperationalLeaf[] = [
  ...EULALIA_BEFORE,
  leaf("beb", "Vendas de bebidas", "op", 20),
  leaf("prod", "Vendas de produtos", "op", 21),
];

Deno.test("Grupo CERVEJAS/CHOPP mapeia para seed Cervejas", () => {
  assertEquals(resolveEpocGrupoCatalogName("CERVEJAS/CHOPP."), "Cervejas");
  assertEquals(resolveEpocGrupoCatalogName("1.2.1 - CERVEJAS/CHOPP"), "Cervejas");
});

Deno.test("Grupo com nome de pagamento nao vira catalogo", () => {
  assertEquals(resolveEpocGrupoCatalogName("Dinheiro"), null);
  assertEquals(resolveEpocGrupoCatalogName("PIX"), null);
  assertEquals(isPaymentMethodCategoryName("Venda Pix"), true);
});

Deno.test("default ignora Dinheiro/Adiantamento e prefere Vendas de produtos", () => {
  const before = pickDefaultRevenueLeaf(EULALIA_BEFORE);
  assertEquals(before?.id, "adi");
  const after = pickDefaultRevenueLeaf(EULALIA_AFTER);
  assertEquals(after?.id, "prod");
});

Deno.test("HEINEKEN 600 vai para Vendas de bebidas, nunca Dinheiro", () => {
  const def = pickDefaultRevenueLeaf(EULALIA_AFTER)!;
  const r = classifyRevenueCategoryHeuristic(
    "HEINEKEN 600",
    EULALIA_AFTER,
    def,
    { catalogNames: ["CERVEJAS/CHOPP."] },
  );
  assertEquals(r.subcategoryId, "beb");
  assertEquals(r.reason === "catalog_bebidas" || r.reason === "heuristic_bebidas", true);
});

Deno.test("HEINEKEN LATA e AMSTEL 600 vao para bebidas", () => {
  const def = pickDefaultRevenueLeaf(EULALIA_AFTER)!;
  assertEquals(
    classifyRevenueCategoryHeuristic("HEINEKEN LATA", EULALIA_AFTER, def)
      .subcategoryId,
    "beb",
  );
  assertEquals(
    classifyRevenueCategoryHeuristic("AMSTEL 600", EULALIA_AFTER, def)
      .subcategoryId,
    "beb",
  );
});

Deno.test("BOLINHOS / PRATOS vao para Vendas de produtos", () => {
  const def = pickDefaultRevenueLeaf(EULALIA_AFTER)!;
  assertEquals(
    classifyRevenueCategoryHeuristic("BOLINHOS", EULALIA_AFTER, def, {
      catalogNames: ["COMIDAS"],
    }).subcategoryId,
    "prod",
  );
  assertEquals(
    classifyRevenueCategoryHeuristic("FRANGO PRATO", EULALIA_AFTER, def)
      .subcategoryId,
    "prod",
  );
});

Deno.test("folha CMV - Bebidas (despesa) nao esta na lista e nao e escolhida", () => {
  const def = pickDefaultRevenueLeaf(EULALIA_AFTER)!;
  const r = classifyRevenueCategoryHeuristic("HEINEKEN 600", EULALIA_AFTER, def);
  assertEquals(r.subcategoryId, "beb");
});

Deno.test("Grupo Dinheiro no CSV nao desvia Heineken para pagamento", () => {
  const def = pickDefaultRevenueLeaf(EULALIA_AFTER)!;
  const r = classifyRevenueCategoryHeuristic(
    "HEINEKEN 600",
    EULALIA_AFTER,
    def,
    { catalogNames: ["Dinheiro"] },
  );
  assertEquals(r.subcategoryId, "beb");
});

Deno.test("VR / Alelo e Pix Epoc nao sao default", () => {
  assertEquals(isPaymentMethodCategoryName("VR / Alelo"), true);
  assertEquals(isPaymentMethodCategoryName("Pix Epoc"), true);
  assertEquals(isUsableCachedSaleLeaf("vr", EULALIA_AFTER), false);
  assertEquals(isUsableCachedSaleLeaf("pixepoc", EULALIA_AFTER), false);
});

Deno.test("sem folhas de mix, Heineken nao cai em Dinheiro se houver produtos", () => {
  const onlyDump = [
    leaf("din", "Dinheiro", "op", 0),
    leaf("prod", "Vendas de produtos", "op", 1),
  ];
  const def = pickDefaultRevenueLeaf(onlyDump)!;
  assertEquals(def.id, "prod");
  const r = classifyRevenueCategoryHeuristic("HEINEKEN 600", onlyDump, def);
  // sem folha bebidas, nao escolhe Dinheiro
  assertEquals(r.subcategoryId, "prod");
});

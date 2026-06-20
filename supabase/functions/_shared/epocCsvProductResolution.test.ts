import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCanonicalProductIndex,
  EpocProductEnsureCoordinator,
  epocExactNameKey,
  epocProductLineKey,
  findEpocFuzzyCatalogMatch,
  registerResolvedEpocProduct,
  resolveEpocProductId,
  scoreEpocProductNameMatch,
} from "./epocCsvProductResolution.ts";
import type { EpocRecipeCatalogEntry } from "./epocCsvProductMatchOpenAi.ts";

Deno.test("scoreEpocProductNameMatch: AGUA COM GAS não é match exato com CRYSTAL", () => {
  const score = scoreEpocProductNameMatch(
    "AGUA COM GAS",
    "AGUA MINERAL CRYSTAL COM GAS",
  );
  assertEquals(score >= 82, true);
  const fuzzy = findEpocFuzzyCatalogMatch(
    [{ id: "p1", name: "AGUA MINERAL CRYSTAL COM GAS" }],
    "AGUA COM GAS",
  );
  assertEquals(fuzzy?.id, "p1");
});

Deno.test("resolveEpocProductId: match exato por nome, sem fuzzy", () => {
  const catalog = [
    { id: "p1", name: "AGUA MINERAL CRYSTAL COM GAS" },
    { id: "p2", name: "AGUA COM GAS" },
  ];
  const cache = new Map<string, string | null>();
  const index = buildCanonicalProductIndex(catalog);
  const r = resolveEpocProductId(
    "AGUA COM GAS",
    catalog,
    cache,
    index,
    [],
  );
  assertEquals(r.productId, "p2");
  const noFuzzy = resolveEpocProductId(
    "AGUA COM GAS",
    [{ id: "p1", name: "AGUA MINERAL CRYSTAL COM GAS" }],
    new Map(),
    buildCanonicalProductIndex([{ id: "p1", name: "AGUA MINERAL CRYSTAL COM GAS" }]),
    [],
  );
  assertEquals(noFuzzy.productId, null);
});

Deno.test("resolveEpocProductId: ficha técnica ativa com mesmo nome", () => {
  const recipes: EpocRecipeCatalogEntry[] = [
    {
      id: "r1",
      name: "Caipirinha",
      output_product_id: "out1",
    },
  ];
  const r = resolveEpocProductId(
    "Caipirinha",
    [],
    new Map(),
    new Map(),
    recipes,
  );
  assertEquals(r.productId, "out1");
});

Deno.test("epocExactNameKey agrupa variações de caixa/acento", () => {
  assertEquals(epocExactNameKey("Água COM GAS"), epocExactNameKey("agua com gas"));
});

Deno.test("resolveEpocProductId reutiliza cache por nome exato", () => {
  const catalog: Array<{
    id: string;
    name: string;
    canonical_name?: string | null;
  }> = [];
  const cache = new Map<string, string | null>();
  const index = buildCanonicalProductIndex(catalog);

  registerResolvedEpocProduct(
    catalog,
    index,
    cache,
    {
      id: "new1",
      name: "AGUA MINERAL SEM GAS",
      canonical_name: "agua mineral",
    },
    epocProductLineKey("AGUA MINERAL SEM GAS"),
    "AGUA MINERAL SEM GAS",
  );

  const second = resolveEpocProductId(
    "AGUA MINERAL SEM GAS",
    catalog,
    cache,
    index,
    [],
  );
  assertEquals(second.productId, "new1");

  const different = resolveEpocProductId(
    "agua mineral 500ml",
    catalog,
    cache,
    index,
    [],
  );
  assertEquals(different.productId, null);
});

Deno.test("EpocProductEnsureCoordinator serializa duas linhas iguais na mesma invocação", async () => {
  const catalog: Array<{
    id: string;
    name: string;
    canonical_name?: string | null;
  }> = [];
  const cache = new Map<string, string | null>();
  const index = buildCanonicalProductIndex(catalog);
  let insertCount = 0;

  const admin = {
    from(table: string) {
      if (table !== "products") throw new Error("unexpected table");
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    eq() {
                      return {
                        async maybeSingle() {
                          return { data: null, error: null };
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
        insert() {
          insertCount += 1;
          return {
            select() {
              return {
                async single() {
                  return {
                    data: {
                      id: "created-1",
                      name: "AGUA MINERAL SEM GAS",
                      unit: "un",
                      canonical_name: "agua mineral",
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  const coord = new EpocProductEnsureCoordinator(
    admin,
    "company-1",
    catalog,
    index,
    cache,
  );

  const params = {
    rawName: "Água Mineral",
    catalogName: "AGUA MINERAL SEM GAS",
    lineKey: "agua mineral",
    canonicalName: "agua mineral",
    inferredUnit: "un",
    autoStock: "DIRECT",
  };

  const [a, b] = await Promise.all([
    coord.ensure(params),
    coord.ensure(params),
  ]);

  assertEquals(insertCount, 1);
  assertEquals(a.productId, "created-1");
  assertEquals(b.productId, "created-1");
});

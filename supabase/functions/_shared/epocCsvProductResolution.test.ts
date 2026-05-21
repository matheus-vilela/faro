import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCanonicalProductIndex,
  EpocProductEnsureCoordinator,
  epocProductLineKey,
  registerResolvedEpocProduct,
  resolveEpocProductId,
} from "./epocCsvProductResolution.ts";

Deno.test("epocProductLineKey unifica variações do CSV com o nome de cadastro", () => {
  const raw = "Coca Cola 350ml";
  const key = epocProductLineKey(raw);
  assertEquals(typeof key, "string");
  assertEquals(key.length > 0, true);
  assertEquals(epocProductLineKey("COCA COLA"), key);
});

Deno.test("resolveEpocProductId encontra por canonical_name no índice", () => {
  const catalog = [
    {
      id: "p1",
      name: "CERVEJA LATA",
      canonical_name: "cerveja lata",
    },
  ];
  const cache = new Map<string, string | null>();
  const index = buildCanonicalProductIndex(catalog);
  const r = resolveEpocProductId(
    "Cerveja Lata 350ml",
    catalog,
    cache,
    index,
  );
  assertEquals(r.productId, "p1");
  assertEquals(r.ambiguous, false);
});

Deno.test("resolveEpocProductId reutiliza produto criado no mesmo job via cache", () => {
  const catalog: Array<{
    id: string;
    name: string;
    canonical_name?: string | null;
  }> = [];
  const cache = new Map<string, string | null>();
  const index = buildCanonicalProductIndex(catalog);

  const first = resolveEpocProductId("Água Mineral", catalog, cache, index);
  assertEquals(first.productId, null);

  registerResolvedEpocProduct(
    catalog,
    index,
    cache,
    {
      id: "new1",
      name: "AGUA MINERAL SEM GAS",
      canonical_name: "agua mineral",
    },
    first.lineKey,
    first.catalogName,
  );

  const second = resolveEpocProductId(
    "agua mineral 500ml",
    catalog,
    cache,
    index,
  );
  assertEquals(second.productId, "new1");
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

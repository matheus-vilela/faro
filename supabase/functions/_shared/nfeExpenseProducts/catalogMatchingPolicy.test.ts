import { assertEquals } from "jsr:@std/assert@1/assert-equals";
import {
  envImportProductLlmDisabled,
  getDefaultCatalogMatchingOpts,
} from "./catalogMatchingPolicy.ts";

function mockSupabase(): Parameters<typeof getDefaultCatalogMatchingOpts>[0] {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: () =>
                  Promise.resolve({
                    data: { company_id: "cid" },
                    error: null,
                  }),
              };
            },
          };
        },
      };
    },
  } as never;
}

function withEnv<K extends string>(
  key: K,
  value: string | undefined,
  fn: () => Promise<void>,
): Promise<void> {
  const prev = Deno.env.get(key);
  return (async () => {
    try {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
      await fn();
    } finally {
      if (prev === undefined) Deno.env.delete(key);
      else Deno.env.set(key, prev);
    }
  })();
}

Deno.test("getDefaultCatalogMatchingOpts PREVIEW_FULL = laboratorio XML", async () => {
  await withEnv("IMPORT_PRODUCT_LLM_DISABLED", undefined, async () => {
    const opts = await getDefaultCatalogMatchingOpts(
      mockSupabase(),
      "c1",
      "PREVIEW_FULL",
    );
    assertEquals(opts?.importBatch, true);
    assertEquals(opts?.skipLlmAssist, false);
    assertEquals(opts?.skipEmbeddingBackfill, false);
  });
});

Deno.test("getDefaultCatalogMatchingOpts PREVIEW_ECONOMY = sem IA", async () => {
  await withEnv("IMPORT_PRODUCT_LLM_DISABLED", undefined, async () => {
    const opts = await getDefaultCatalogMatchingOpts(
      mockSupabase(),
      "c1",
      "PREVIEW_ECONOMY",
    );
    assertEquals(opts?.skipLlmAssist, true);
    assertEquals(opts?.skipEmbeddingBackfill, true);
  });
});

Deno.test("IMPORT_PRODUCT_LLM_DISABLED força IA desligada", async () => {
  await withEnv("IMPORT_PRODUCT_LLM_DISABLED", "true", async () => {
    assertEquals(envImportProductLlmDisabled(), true);
    const opts = await getDefaultCatalogMatchingOpts(
      mockSupabase(),
      "c1",
      "XML_BATCH_OR_LAB",
    );
    assertEquals(opts?.skipLlmAssist, true);
    assertEquals(opts?.skipEmbeddingBackfill, true);
  });
});

Deno.test("IMPORT_PRODUCT_LLM_DISABLED + WhatsApp: só skips, sem importBatch", async () => {
  await withEnv("IMPORT_PRODUCT_LLM_DISABLED", "1", async () => {
    const opts = await getDefaultCatalogMatchingOpts(
      mockSupabase(),
      "c1",
      "WHATSAPP_INTERACTIVE",
    );
    assertEquals(opts?.importBatch, undefined);
    assertEquals(opts?.skipLlmAssist, true);
  });
});

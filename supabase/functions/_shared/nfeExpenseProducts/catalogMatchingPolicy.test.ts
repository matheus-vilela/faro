import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
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

Deno.test("getDefaultCatalogMatchingOpts PREVIEW_FULL = sem IA", async () => {
  const opts = await getDefaultCatalogMatchingOpts(
    mockSupabase(),
    "c1",
    "PREVIEW_FULL",
  );
  assertEquals(opts?.importBatch, true);
  assertEquals(opts?.skipLlmAssist, true);
  assertEquals(opts?.skipEmbeddingBackfill, true);
});

Deno.test("getDefaultCatalogMatchingOpts PREVIEW_ECONOMY = sem IA", async () => {
  const opts = await getDefaultCatalogMatchingOpts(
    mockSupabase(),
    "c1",
    "PREVIEW_ECONOMY",
  );
  assertEquals(opts?.skipLlmAssist, true);
  assertEquals(opts?.skipEmbeddingBackfill, true);
});

Deno.test("XML_BATCH_OR_LAB sempre sem IA", async () => {
  assertEquals(envImportProductLlmDisabled(), true);
  const opts = await getDefaultCatalogMatchingOpts(
    mockSupabase(),
    "c1",
    "XML_BATCH_OR_LAB",
  );
  assertEquals(opts?.skipLlmAssist, true);
  assertEquals(opts?.skipEmbeddingBackfill, true);
});

Deno.test("WhatsApp: skips sem importBatch", async () => {
  const opts = await getDefaultCatalogMatchingOpts(
    mockSupabase(),
    "c1",
    "WHATSAPP_INTERACTIVE",
  );
  assertEquals(opts?.importBatch, undefined);
  assertEquals(opts?.skipLlmAssist, true);
});

import { assertEquals } from "jsr:@std/assert@1";
import { lineNeedsCatalogProductReview } from "./batchImportPendingMessaging.ts";

Deno.test("lineNeedsCatalogProductReview: AUTO_MATCH com produto => não", () => {
  assertEquals(
    lineNeedsCatalogProductReview({
      resolution: "AUTO_MATCH",
      productId: "uuid-1",
      pm: { resolutionStatus: "AUTO_MATCH", needsConfirmation: false },
    }),
    false,
  );
});

Deno.test("lineNeedsCatalogProductReview: sem produto => sim", () => {
  assertEquals(
    lineNeedsCatalogProductReview({
      resolution: "PENDING_REVIEW",
      productId: null,
      pm: { resolutionStatus: "PENDING_USER_CONFIRM" },
    }),
    true,
  );
});

Deno.test("lineNeedsCatalogProductReview: NEW_PRODUCT_CREATED com pm residual => não", () => {
  assertEquals(
    lineNeedsCatalogProductReview({
      resolution: "NEW_PRODUCT_CREATED",
      productId: "uuid-new",
      pm: {
        resolutionStatus: "NEW_PRODUCT_STAGED",
        needsConfirmation: true,
      },
    }),
    false,
  );
});

Deno.test("lineNeedsCatalogProductReview: AUTO_MATCH com needsConfirmation => não", () => {
  assertEquals(
    lineNeedsCatalogProductReview({
      resolution: "AUTO_MATCH",
      productId: "uuid-1",
      pm: { resolutionStatus: "AUTO_MATCH", needsConfirmation: true },
    }),
    false,
  );
});

Deno.test("lineNeedsCatalogProductReview: NEW_PRODUCT_STAGED => sim", () => {
  assertEquals(
    lineNeedsCatalogProductReview({
      resolution: "PENDING_REVIEW",
      productId: "x",
      pm: { resolutionStatus: "NEW_PRODUCT_STAGED", needsConfirmation: false },
    }),
    true,
  );
});

Deno.test("lineNeedsCatalogProductReview: SKIPPED => não", () => {
  assertEquals(
    lineNeedsCatalogProductReview({
      resolution: "SKIPPED",
      productId: null,
      pm: undefined,
    }),
    false,
  );
});

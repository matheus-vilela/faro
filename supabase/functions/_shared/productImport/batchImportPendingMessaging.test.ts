import { assertEquals } from "jsr:@std/assert@1/assert-equals";
import {
  batchImportReviewPendingTitleDetail,
  importJobItemPendingReason,
} from "./batchImportPendingMessaging.ts";

Deno.test("importJobItemPendingReason prefers resolution status label", () => {
  assertEquals(
    importJobItemPendingReason({
      resolutionStatus: "UNIT_CONFLICT_PENDING",
      matchReason: "extra",
    }),
    "Conflito de unidade",
  );
});

Deno.test("importJobItemPendingReason falls back to trimmed matchReason", () => {
  assertEquals(
    importJobItemPendingReason({
      resolutionStatus: "",
      matchReason: "Motivo longo do matcher",
    }),
    "Motivo longo do matcher",
  );
});

Deno.test("batchImportReviewPendingTitleDetail marks missing product", () => {
  const x = batchImportReviewPendingTitleDetail({
    productName: "Item X",
    pm: { resolutionStatus: "PENDING_USER_CONFIRM", matchReason: "" },
    missingProduct: true,
  });
  assertEquals(x.reason_code, "MISSING_PRODUCT");
  assertEquals(x.title, "Sem produto resolvido — Item X");
});

Deno.test("batchImportReviewPendingTitleDetail uses status when product exists", () => {
  const x = batchImportReviewPendingTitleDetail({
    productName: "Limão",
    pm: {
      resolutionStatus: "UNIT_CONFLICT_PENDING",
      matchReason: "Detalhe técnico",
    },
    missingProduct: false,
  });
  assertEquals(x.reason_code, "UNIT_CONFLICT_PENDING");
  assertEquals(x.title, "Conflito de unidade — Limão");
  assertEquals(x.detail, "Detalhe técnico");
});

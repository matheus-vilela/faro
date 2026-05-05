import { assertEquals } from "jsr:@std/assert@1";
import {
  buildCostSuggestion,
  buildPreviewLineDecision,
  detectPossibleFichaTecnica,
  isGreenPathNewCatalogItem,
  matchReuseFromProductMatch,
  previewDefaultThresholds,
  stockQuantityFallback,
} from "./devPreviewDecision.ts";

Deno.test("detectPossibleFichaTecnica: nome com ficha técnica", () => {
  const a = detectPossibleFichaTecnica("Mistura Ficha Tecnica FT-12");
  assertEquals(a.hit, true);
  assertEquals(a.reason_codes.includes("POSSIBLE_FICHA_TECNICA_NAME"), true);
});

Deno.test("detectPossibleFichaTecnica: nome genérico", () => {
  const a = detectPossibleFichaTecnica("ARROZ BRANCO TIPO 1 5KG");
  assertEquals(a.hit, false);
});

Deno.test("buildCostSuggestion: coerência q×v vs total", () => {
  const ok = buildCostSuggestion({
    quantityInvoice: 10,
    unitValueInvoice: 5,
    lineTotal: 50,
    quantityInPrimary: 10,
  });
  assertEquals(ok.line_total_check_ok, true);
  assertEquals(ok.unit_cost_in_primary, 5);
});

Deno.test("buildCostSuggestion: divergência numérica", () => {
  const bad = buildCostSuggestion({
    quantityInvoice: 10,
    unitValueInvoice: 5,
    lineTotal: 99,
    quantityInPrimary: 10,
  });
  assertEquals(bad.line_total_check_ok, false);
});

Deno.test("matchReuseFromProductMatch: resolved reaproveita", () => {
  const th = previewDefaultThresholds();
  const m = matchReuseFromProductMatch(
    {
      resolvedProductId: "p1",
      suggestedProductId: "p1",
      suggestedScore: 70,
      needsConfirmation: true,
      resolutionStatus: "PENDING_USER_CONFIRM",
    },
    th,
  );
  assertEquals(m.reused_existing_product, true);
  assertEquals(m.blocked_new_product_suggestion, true);
});

Deno.test("matchReuseFromProductMatch: sugestão forte sem confirmação", () => {
  const th = previewDefaultThresholds();
  const m = matchReuseFromProductMatch(
    {
      resolvedProductId: null,
      suggestedProductId: "p9",
      suggestedScore: th.autoMatchMinScore,
      needsConfirmation: false,
      resolutionStatus: "AUTO_MATCH",
    },
    th,
  );
  assertEquals(m.reused_existing_product, true);
  assertEquals(m.blocked_new_product_suggestion, true);
});

Deno.test("matchReuseFromProductMatch: novo produto", () => {
  const th = previewDefaultThresholds();
  const m = matchReuseFromProductMatch(
    {
      resolvedProductId: null,
      suggestedProductId: null,
      suggestedScore: 10,
      needsConfirmation: true,
      resolutionStatus: "NEW_PRODUCT_STAGED",
    },
    th,
  );
  assertEquals(m.reused_existing_product, false);
  assertEquals(m.blocked_new_product_suggestion, false);
});

Deno.test("isGreenPathNewCatalogItem: batch sem candidato forte", () => {
  const th = previewDefaultThresholds();
  assertEquals(
    isGreenPathNewCatalogItem(
      {
        needsConfirmation: false,
        resolvedProductId: null,
        suggestedProductId: null,
        suggestedScore: 30,
        resolutionStatus: "NEW_PRODUCT_STAGED",
      },
      th,
      true,
    ),
    true,
  );
});

Deno.test("buildPreviewLineDecision: green path só marca unidade ≠ UN", () => {
  const d = buildPreviewLineDecision({
    productName: "Item X",
    quantityInvoice: 1,
    unitValueInvoice: 10,
    lineTotal: 10,
    productMatch: {
      resolvedProductId: null,
      suggestedProductId: null,
      suggestedScore: 20,
      needsConfirmation: false,
      resolutionStatus: "NEW_PRODUCT_STAGED",
      borderlineLlmSuggestedName: "Item X",
    },
    unitSuggestion: {
      primary_unit_code: "kg",
      suggested_conversions: [],
      suggested_stock_quantity_in_primary: 1,
    },
    existingConversions: [],
    recipeEvidence: null,
    simulateImportBatch: true,
  });
  assertEquals(d.manual_review.required, true);
  assertEquals(d.manual_review.reason_codes.includes("PRIMARY_UNIT_NOT_UN"), true);
  assertEquals(d.manual_review.reason_codes.includes("NO_CLEAR_EXISTING_PRODUCT"), false);
});

Deno.test("buildPreviewLineDecision: item novo batch não exige revisão por match", () => {
  const d = buildPreviewLineDecision({
    productName: "Limão Tahiti",
    quantityInvoice: 2,
    unitValueInvoice: 3,
    lineTotal: 6,
    productMatch: {
      resolvedProductId: null,
      suggestedProductId: null,
      suggestedScore: 35,
      needsConfirmation: false,
      resolutionStatus: "NEW_PRODUCT_STAGED",
      borderlineLlmSuggestedName: "Limão Tahiti",
      decisionPath: "import_batch_deterministic_new",
    },
    unitSuggestion: {
      primary_unit_code: "un",
      suggested_conversions: [],
      suggested_stock_quantity_in_primary: 2,
    },
    existingConversions: [],
    recipeEvidence: null,
    simulateImportBatch: true,
  });
  assertEquals(d.match_reuse.planned_auto_catalog_create, true);
  assertEquals(
    d.manual_review.reason_codes.includes("NO_CLEAR_EXISTING_PRODUCT"),
    false,
  );
  assertEquals(
    d.manual_review.reason_codes.includes("PRODUCT_MATCH_NEEDS_CONFIRMATION"),
    false,
  );
});

Deno.test("buildPreviewLineDecision: escopo dev_preview_only", () => {
  const d = buildPreviewLineDecision({
    productName: "Teste",
    quantityInvoice: 2,
    unitValueInvoice: 10,
    lineTotal: 20,
    productMatch: {
      resolvedProductId: "x",
      suggestedProductId: "x",
      suggestedScore: 100,
      needsConfirmation: false,
      resolutionStatus: "AUTO_MATCH",
    },
    unitSuggestion: {
      primary_unit_code: "kg",
      suggested_conversions: [],
      suggested_stock_quantity_in_primary: 2,
    },
    existingConversions: [
      {
        primary_unit_code: "kg",
        secondary_unit_code: "g",
        primary_qty: 1,
        secondary_qty: 1000,
      },
    ],
    recipeEvidence: {
      is_recipe_output: false,
      is_recipe_ingredient: true,
      has_operational_recipe_link: false,
    },
    simulateImportBatch: false,
  });
  assertEquals(d.scope, "dev_preview_only");
  assertEquals(d.conversion_plan.existing_conversions_summary.length, 1);
  assertEquals(d.match_reuse.blocked_new_product_suggestion, true);
});

Deno.test("stockQuantityFallback: KG nota → KG cadastro", () => {
  const s = stockQuantityFallback({
    invoiceQuantity: 3,
    invoiceUnitRaw: "KG",
    catalogUnitRaw: "kg",
  });
  assertEquals(s, 3);
});

Deno.test("stockQuantityFallback: G nota → KG cadastro", () => {
  const s = stockQuantityFallback({
    invoiceQuantity: 500,
    invoiceUnitRaw: "G",
    catalogUnitRaw: "kg",
  });
  assertEquals(s, 0.5);
});

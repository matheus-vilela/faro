/**
 * Match + resolução de catálogo **antes** de existir `expense_id` / linhas em `expense_items`
 * (fluxo unificado com `process-import-job-batch`).
 */
import type { ItemWithProductMatch } from "../../received-whatsapp-message/productMatch.ts";
import {
  compactProductMatchForPendingPayload,
  lineNeedsCatalogProductReview,
  shouldQueueImportReviewPending,
} from "../productImport/batchImportPendingMessaging.ts";
import { DEFAULT_IMPORT_MATCH_THRESHOLDS } from "../productImport/matchConfig.ts";
import { stripPackSizeFromLabel } from "../productImport/packSizeFromLabel.ts";
import {
  pickInvoiceUnitRaw,
  type ExtractedItemWithInvoiceMeta,
} from "../productImport/consolidateItems.ts";
import type { ExtractedExpenseItem } from "../openaiExpense.ts";
import { catalogRegistrationNameFromNfeLine } from "./newProductCatalogFromNfe.ts";
import { fetchProductDefaultExpenseCategoryById, preferredPurchaseCategoryId } from "../productDefaultExpenseCategory.ts";
import {
  fetchCompanyNcmCategoryMap,
  ncmKeyForCategoryRule,
  resolvePurchaseCategoryId,
} from "../ncmCategoryRule.ts";
import { matchNfeExpenseCatalogLines } from "./matchPipeline.ts";
import {
  createProductAutoWhenNoReviewQueue,
  ensureProductForLine,
  mapResolution,
} from "./motorLineResolution.ts";
import type { NfeCatalogLineResolution } from "./types.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export type NfeXmlBatchFinalizeMeta = {
  xml_line_identity: string;
  resolution: NfeCatalogLineResolution;
  product_id_snapshot: string | null;
  unit_conflict_auto_linked?: boolean;
  import_resolution_status: string | null;
  match_score: number | null;
  review_queue:
    | null
    | {
      should_queue: boolean;
      pm_compact: Record<string, unknown>;
      suggested_catalog_name: string | null;
      raw_xml_name: string;
      candidate_product_ids: string[];
    };
};

export type BuiltXmlCatalogExpenseLine = {
  insertRow: Record<string, unknown>;
};

export async function buildNfeXmlExpenseItemInserts(
  supabase: SupabaseClient,
  params: {
    companyId: string;
    items: ExtractedExpenseItem[];
    motorVersion: string;
    xmlLineIdentities: string[];
    supplierId?: string | null;
  },
): Promise<{
  matchResult: Awaited<ReturnType<typeof matchNfeExpenseCatalogLines>>;
  lines: BuiltXmlCatalogExpenseLine[];
}> {
  const { companyId, items, motorVersion, xmlLineIdentities, supplierId } =
    params;
  const matchResult = await matchNfeExpenseCatalogLines(
    supabase,
    companyId,
    items,
    "XML_BATCH_OR_LAB",
    { supplierId: supplierId ?? null },
  );

  const catalogNameById = new Map<string, string>();
  const defaultCategoryByProductId = new Map<string, string>();
  const candidateIds = new Set<string>();
  const minAuto = DEFAULT_IMPORT_MATCH_THRESHOLDS.autoMatchMinScore;
  for (let j = 0; j < items.length; j += 1) {
    const lineItem = matchResult.items[j] as ItemWithProductMatch | undefined;
    const p = lineItem?.productMatch;
    let cand =
      String(p?.resolvedProductId ?? "").trim() ||
      (p?.resolutionStatus === "AUTO_MATCH"
        ? String(p?.suggestedProductId ?? "").trim()
        : "");
    if (
      !cand &&
      p?.resolutionStatus === "UNIT_CONFLICT_PENDING" &&
      p.unitConvertible &&
      Number(p?.suggestedScore ?? 0) >= minAuto
    ) {
      cand = String(p?.suggestedProductId ?? "").trim();
    }
    if (cand) candidateIds.add(cand);
  }
  if (candidateIds.size > 0) {
    const { data: prodRows } = await supabase
      .from("products")
      .select("id, name, default_expense_category_id, cmv_category_id")
      .eq("company_id", companyId)
      .in("id", [...candidateIds]);
    for (const r of prodRows ?? []) {
      const id = String((r as { id?: string }).id ?? "").trim();
      const nm = String((r as { name?: string }).name ?? "").trim();
      const cat = preferredPurchaseCategoryId(
        r as {
          default_expense_category_id?: string | null;
          cmv_category_id?: string | null;
        },
      );
      if (id && nm) catalogNameById.set(id, nm);
      if (id && cat) defaultCategoryByProductId.set(id, cat);
    }
  }

  const ncmCategoryByNcm = await fetchCompanyNcmCategoryMap(supabase, companyId);

  const lines: BuiltXmlCatalogExpenseLine[] = [];

  for (let i = 0; i < items.length; i += 1) {
    const lineItem = matchResult.items[i] as ItemWithProductMatch | undefined;
    const pm = lineItem?.productMatch;
    const xml_line_identity = xmlLineIdentities[i] ?? `nItem:${i + 1}:cProd:x`;

    let productId =
      String(pm?.resolvedProductId ?? "").trim() ||
      (pm?.resolutionStatus === "AUTO_MATCH"
        ? String(pm?.suggestedProductId ?? "").trim()
        : "") ||
      null;
    let unitConflictAutoLinked = false;
    if (!productId && pm) {
      const sid = String(pm.suggestedProductId ?? "").trim();
      const score = Number(pm.suggestedScore ?? 0);
      if (
        sid &&
        pm.resolutionStatus === "UNIT_CONFLICT_PENDING" &&
        pm.unitConvertible &&
        score >= minAuto
      ) {
        productId = sid;
        unitConflictAutoLinked = true;
      }
    }
    let createdNew = false;
    let stockAppliedOnCreate = false;
    if (pm) {
      const ensured = await ensureProductForLine(
        supabase,
        companyId,
        items[i]!,
        pm,
        supplierId,
      );
      if (!productId && ensured.productId) {
        productId = ensured.productId;
        createdNew = ensured.created;
        stockAppliedOnCreate = ensured.stockApplied === true;
      }
    }

    let resolutionLabel: NfeCatalogLineResolution = mapResolution(pm, createdNew);
    if (
      unitConflictAutoLinked &&
      String(productId ?? "").trim() &&
      !createdNew &&
      resolutionLabel !== "NEW_PRODUCT_CREATED"
    ) {
      resolutionLabel = "AUTO_MATCH";
    }

    const pmRecord = pm as unknown as Record<string, unknown> | undefined;
    let pmForReview: Record<string, unknown> | undefined = pmRecord;
    if (unitConflictAutoLinked && productId && pmRecord) {
      pmForReview = {
        ...pmRecord,
        resolutionStatus: "AUTO_MATCH",
        needsConfirmation: false,
        resolvedProductId: productId,
      };
    }

    const rawXmlName = String(items[i]?.productName ?? "").trim() || "Item";
    const strippedDisplay = stripPackSizeFromLabel(rawXmlName).trim() || rawXmlName;

    let pmForLineNeeds: Record<string, unknown> | undefined = pmForReview;
    let needsCatalogReview = lineNeedsCatalogProductReview({
      resolution: resolutionLabel,
      productId,
      pm: pmForLineNeeds,
    });
    let shouldQueue = shouldQueueImportReviewPending({
      needsCatalogReview,
      productId,
      pm: pmForLineNeeds,
    });

    if (!productId && needsCatalogReview && !shouldQueue && pm) {
      const fb = await createProductAutoWhenNoReviewQueue(
        supabase,
        companyId,
        items[i]!,
        pm,
        supplierId,
      );
      if (fb.productId) {
        productId = fb.productId;
        if (fb.created) {
          createdNew = true;
          stockAppliedOnCreate = fb.stockApplied === true;
          resolutionLabel = "NEW_PRODUCT_CREATED";
        } else {
          resolutionLabel = "AUTO_MATCH";
        }
        if (pmForReview) {
          pmForLineNeeds = {
            ...pmForReview,
            resolvedProductId: productId,
            resolutionStatus: "AUTO_MATCH",
            needsConfirmation: false,
          };
        }
        needsCatalogReview = lineNeedsCatalogProductReview({
          resolution: resolutionLabel,
          productId,
          pm: pmForLineNeeds,
        });
        shouldQueue = shouldQueueImportReviewPending({
          needsCatalogReview,
          productId,
          pm: pmForLineNeeds,
        });
      }
    }

    const importPendingResolution = needsCatalogReview;

    const import_resolution_status_line =
      unitConflictAutoLinked && String(productId ?? "").trim()
        ? "AUTO_MATCH"
        : (pm?.resolutionStatus ?? null);

    const batchFinalize: NfeXmlBatchFinalizeMeta = {
      xml_line_identity,
      resolution: resolutionLabel,
      product_id_snapshot: productId,
      unit_conflict_auto_linked: unitConflictAutoLinked || undefined,
      import_resolution_status: import_resolution_status_line,
      match_score: pm?.suggestedScore ?? null,
      review_queue: null,
    };

    if (shouldQueue && pm) {
      const suggestedCatalogName = catalogRegistrationNameFromNfeLine(items[i]!, pm);
      batchFinalize.review_queue = {
        should_queue: true,
        pm_compact: compactProductMatchForPendingPayload(pmRecord),
        suggested_catalog_name: suggestedCatalogName || null,
        raw_xml_name: rawXmlName,
        candidate_product_ids: [String(pm?.suggestedProductId ?? "").trim()].filter(Boolean),
      };
    }

    let productNameOut: string;
    if (productId) {
      let catName = catalogNameById.get(productId);
      if (!catName) {
        const { data: one } = await supabase
          .from("products")
          .select("name")
          .eq("company_id", companyId)
          .eq("id", productId)
          .maybeSingle();
        catName = String((one as { name?: string } | null)?.name ?? "").trim();
        if (catName) catalogNameById.set(productId, catName);
      }
      productNameOut = catName || strippedDisplay;
    } else {
      productNameOut = pm
        ? catalogRegistrationNameFromNfeLine(items[i]!, pm) || strippedDisplay
        : strippedDisplay;
    }

    const q = Math.max(0.0001, Number(items[i]?.quantity ?? 0));
    const uv = Number(items[i]?.unitValue ?? 0);
    const stockQty = Number(items[i]?.quantity ?? q);

    const insertRow: Record<string, unknown> = {
      product_name: productNameOut,
      quantity: q,
      unit_value: uv,
      invoice_unit: invUnit,
      stock_quantity: Number.isFinite(stockQty) ? stockQty : q,
      stock_added: stockAppliedOnCreate,
      import_nature: "ESTOQUE_DIRETO",
      import_engine_suggestion: "XML_CATALOG_MOTOR_APPLIED",
      import_confidence_0_1: pm?.suggestedScore != null
        ? Math.round(Number(pm.suggestedScore) / 10) / 100
        : null,
      import_score_reasons_json: {
        xml_catalog_motor: {
          motor_version: motorVersion,
          decision_path: pm?.decisionPath ?? null,
          borderline_llm_rationale: pm?.borderlineLlmRationale ?? null,
          resolution: resolutionLabel,
          unit_conflict_auto_linked: unitConflictAutoLinked || undefined,
          invoice_line_units_llm: pm?.invoice_line_units_llm ?? undefined,
          batch_finalize: batchFinalize,
        },
      },
      import_stock_resolution: null,
      resolved_entry_breakdown_recipe_id: null,
      import_pending_resolution: importPendingResolution,
      import_resolution_status: import_resolution_status_line,
      import_applied_rule_id: null,
      match_score: pm?.suggestedScore ?? null,
      match_decision_reason: pm?.matchReason ?? null,
    };

    if (productId) {
      insertRow.product_id = productId;
      if (!defaultCategoryByProductId.has(productId)) {
        const extra = await fetchProductDefaultExpenseCategoryById(
          supabase,
          companyId,
          [productId],
        );
        const cat = extra.get(productId);
        if (cat) defaultCategoryByProductId.set(productId, cat);
      }
    }
    const ncmKey = ncmKeyForCategoryRule(items[i]?.ncm);
    const resolvedCat = resolvePurchaseCategoryId({
      productCategoryId: productId
        ? defaultCategoryByProductId.get(productId) ?? null
        : null,
      ncmCategoryId: ncmKey
        ? ncmCategoryByNcm.get(ncmKey)?.dreCategoryId ?? null
        : null,
    });
    if (resolvedCat) insertRow.company_category_id = resolvedCat;
    if (pm?.stockQuantity != null) insertRow.stock_quantity = pm.stockQuantity;
    if (pm?.conversionFactorApplied != null) {
      insertRow.conversion_factor_applied = pm.conversionFactorApplied;
    }
    if (pm?.resolutionSource) insertRow.resolution_source = pm.resolutionSource;
    if (pm?.invoiceUnitNormalized) {
      insertRow.normalized_invoice_unit = String(pm.invoiceUnitNormalized);
    }
    insertRow.invoice_unit = pickInvoiceUnitRaw(items[i] as ExtractedItemWithInvoiceMeta);
    insertRow.ncm = items[i]?.ncm ?? null;
    insertRow.ean = items[i]?.ean ?? null;

    lines.push({ insertRow });
  }

  return { matchResult, lines };
}

import {
  type ItemWithProductMatch,
  upsertProductInvoiceAlias,
} from "../../received-whatsapp-message/productMatch.ts";
import {
  batchImportReviewPendingTitleDetail,
  compactProductMatchForPendingPayload,
  lineNeedsCatalogProductReview,
  shouldQueueImportReviewPending,
} from "../productImport/batchImportPendingMessaging.ts";
import { upsertImportPendingReviewCompanyAlert } from "../upsertImportPendingReviewCompanyAlert.ts";
import { DEFAULT_IMPORT_MATCH_THRESHOLDS } from "../productImport/matchConfig.ts";
import { stripPackSizeFromLabel } from "../productImport/packSizeFromLabel.ts";
import {
  pickInvoiceUnitRaw,
  type ExtractedItemWithInvoiceMeta,
} from "../productImport/consolidateItems.ts";
import { loadNfeMotorExtractContext } from "./extractFromStoredContext.ts";
import { catalogRegistrationNameFromNfeLine } from "./newProductCatalogFromNfe.ts";
import { matchNfeExpenseCatalogLines } from "./matchPipeline.ts";
import { reconcileNfeFinancials } from "./financialReconciliation.ts";
import type {
  NfeCatalogLineResolution,
  NfeExpenseProductsInput,
  NfeExpenseProductsResult,
  NfeExpenseProductsResultLine,
} from "./types.ts";
import {
  createProductAutoWhenNoReviewQueue,
  ensureProductForLine,
  mapResolution,
} from "./motorLineResolution.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

async function runNfeMotorApplyTail(
  supabase: SupabaseClient,
  params: {
    companyId: string;
    expenseId: string;
    financial: import("./types.ts").FinancialReconciliationOutcome;
    motorReviewRows: Array<Record<string, unknown>>;
  },
): Promise<void> {
  const { companyId, expenseId, financial, motorReviewRows } = params;
  const finUp = financial.expense_update;
  await supabase
    .from("expenses")
    .update({
      divergence_reason: finUp?.divergence_reason ?? null,
      financial_reconciliation_json: finUp?.financial_reconciliation_json ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", expenseId)
    .eq("company_id", companyId);

  await supabase
    .from("import_review_pending")
    .delete()
    .eq("company_id", companyId)
    .eq("expense_id", expenseId)
    .eq("kind", "missing_product_match")
    .eq("status", "OPEN");
  if (motorReviewRows.length > 0) {
    const { error: insPendErr } = await supabase
      .from("import_review_pending")
      .insert(motorReviewRows);
    if (insPendErr) {
      console.error(
        "[nfeExpenseMotor] import_review_pending:",
        insPendErr.message,
      );
    }
  }
  await upsertImportPendingReviewCompanyAlert(supabase, companyId);

  const { data: stockRpc, error: stockRpcErr } = await supabase.rpc(
    "apply_xml_import_direct_stock_for_expense",
    { p_expense_id: expenseId },
  );
  if (stockRpcErr) {
    console.error(
      "[nfeExpenseMotor] apply_xml_import_direct_stock_for_expense:",
      stockRpcErr.message,
    );
  } else {
    const stockPayload = stockRpc as {
      ok?: boolean;
      lines_applied?: number;
      error?: string;
    };
    if (stockPayload?.ok === false) {
      console.error(
        "[nfeExpenseMotor] stock_apply:",
        stockPayload.error ?? stockRpc,
      );
    }
  }

  const { data: recRpc, error: recRpcErr } = await supabase.rpc(
    "finalize_onboarding_xml_recebimento_for_expense",
    { p_expense_id: expenseId },
  );
  if (recRpcErr) {
    console.error(
      "[nfeExpenseMotor] finalize_onboarding_xml_recebimento_for_expense:",
      recRpcErr.message,
    );
  } else {
    const recPayload = recRpc as {
      ok?: boolean;
      skipped?: boolean;
      error?: string;
    };
    if (recPayload?.ok === false) {
      console.error(
        "[nfeExpenseMotor] recebimento_finalize:",
        recPayload.error ?? recRpc,
      );
    }
  }
}

export async function runNfeExpenseProductMotor(
  supabase: SupabaseClient,
  input: NfeExpenseProductsInput,
): Promise<NfeExpenseProductsResult> {
  const errors: string[] = [];
  const companyId = String(input.company_id ?? "").trim();
  const expenseId = String(input.expense_id ?? "").trim();
  const motorVersion = String(input.motor_version ?? "").trim();
  const mode = input.mode;

  if (!companyId || !expenseId || !motorVersion) {
    return {
      ok: false,
      expense_id: expenseId || "",
      lines: [],
      financial: {
        document_total: null,
        sum_lines: 0,
        gaps: {},
        status: "PARTIAL_UNKNOWN",
      },
      errors: ["company_id, expense_id e motor_version são obrigatórios."],
    };
  }

  if (input.finalize_after_batch_insert && mode !== "apply") {
    return {
      ok: false,
      expense_id: expenseId,
      lines: [],
      financial: {
        document_total: null,
        sum_lines: 0,
        gaps: {},
        status: "PARTIAL_UNKNOWN",
      },
      errors: ["finalize_after_batch_insert requer mode=apply."],
    };
  }

  const { data: expRow, error: expErr } = await supabase
    .from("expenses")
    .select("id, document_total")
    .eq("company_id", companyId)
    .eq("id", expenseId)
    .maybeSingle();
  if (expErr || !expRow?.id) {
    return {
      ok: false,
      expense_id: expenseId,
      lines: [],
      financial: {
        document_total: null,
        sum_lines: 0,
        gaps: {},
        status: "PARTIAL_UNKNOWN",
      },
      errors: ["Despesa não encontrada para a empresa."],
    };
  }

  const ctx = await loadNfeMotorExtractContext(
    supabase,
    companyId,
    expenseId,
    input.import_job_file_id?.trim(),
  );
  if (!ctx) {
    return {
      ok: false,
      expense_id: expenseId,
      lines: [],
      financial: {
        document_total: null,
        sum_lines: 0,
        gaps: {},
        status: "PARTIAL_UNKNOWN",
      },
      errors: ["Contexto NF-e indisponível (log de importação sem payload de itens)."],
    };
  }

  const { data: expenseItemRows } = await supabase
    .from("expense_items")
    .select("id, product_id, import_score_reasons_json")
    .eq("expense_id", expenseId)
    .order("created_at", { ascending: true });

  const expenseItemIds = (expenseItemRows ?? []).map((r: { id: string }) =>
    String(r.id)
  );
  const existingProductIds = (expenseItemRows ?? []).map((r: {
    product_id?: string | null;
  }) => String(r.product_id ?? "").trim() || null);

  if (expenseItemIds.length !== ctx.items.length) {
    errors.push(
      `Contagem de linhas (${ctx.items.length}) ≠ expense_items (${expenseItemIds.length}).`,
    );
  }

  const financial = reconcileNfeFinancials({
    items: ctx.items,
    expenseDocumentTotal: (expRow as { document_total?: number | null })
      .document_total,
    xmlText: ctx.xml_text,
  });

  const finalizeOnly = Boolean(input.finalize_after_batch_insert) && mode === "apply";

  if (finalizeOnly) {
    const linesOutFin: NfeExpenseProductsResultLine[] = [];
    const motorReviewRowsFin: Array<Record<string, unknown>> = [];

    for (let i = 0; i < ctx.items.length; i += 1) {
      const expenseItemId = expenseItemIds[i] ?? "";
      const eiRow = (expenseItemRows ?? [])[i] as {
        id?: string;
        product_id?: string | null;
        import_score_reasons_json?: unknown;
      } | undefined;
      const js = eiRow?.import_score_reasons_json as Record<string, unknown> | null;
      const xcm = js?.xml_catalog_motor as Record<string, unknown> | undefined;
      const batchFinalize = xcm?.batch_finalize as Record<string, unknown> | undefined;
      const xml_line_identity =
        String(batchFinalize?.xml_line_identity ?? "").trim() ||
        ctx.xml_line_identities[i] ||
        `nItem:${i + 1}:cProd:x`;
      const rawRow = ctx.raw_rows_ordered[i];
      const raw_import_id_from_ctx =
        rawRow?.id && String(rawRow.id).trim() ? String(rawRow.id) : null;
      const raw_import_id =
        batchFinalize?.raw_import_id != null && String(batchFinalize.raw_import_id).trim()
          ? String(batchFinalize.raw_import_id).trim()
          : raw_import_id_from_ctx;

      if (!expenseItemId) {
        linesOutFin.push({
          expense_item_id: "",
          raw_import_id,
          xml_line_identity,
          resolution: "SKIPPED",
          product_id: null,
          confidence: null,
          reasons_json: { error: "expense_item em falta para este índice", finalize_only: true },
        });
        continue;
      }

      if (!batchFinalize) {
        errors.push(
          `Linha ${i + 1}: finalize-only requer import_score_reasons_json.xml_catalog_motor.batch_finalize.`,
        );
        linesOutFin.push({
          expense_item_id: expenseItemId,
          raw_import_id,
          xml_line_identity,
          resolution: "SKIPPED",
          product_id: null,
          confidence: null,
          reasons_json: { error: "batch_finalize em falta", finalize_only: true },
        });
        continue;
      }

      const productId =
        String(eiRow?.product_id ?? "").trim() ||
        String(batchFinalize.product_id_snapshot ?? "").trim() ||
        null;
      const resolutionLabel = String(batchFinalize.resolution ?? "PENDING_REVIEW") as NfeCatalogLineResolution;
      const unitConflictAutoLinked = Boolean(batchFinalize.unit_conflict_auto_linked);
      const rq = batchFinalize.review_queue as Record<string, unknown> | null | undefined;

      if (mode === "apply") {
        if (productId) {
          await upsertProductInvoiceAlias(
            supabase,
            companyId,
            String(ctx.items[i]?.productName ?? "").trim() || "Item",
            productId,
          );
        }
        if (raw_import_id && productId) {
          await supabase
            .from("onboarding_import_item_raw")
            .update({
              created_product_id: productId,
              updated_at: new Date().toISOString(),
            })
            .eq("id", raw_import_id)
            .eq("company_id", companyId);
        }

        await supabase.from("expense_xml_item_motor_pass").upsert(
          {
            company_id: companyId,
            expense_id: expenseId,
            expense_item_id: expenseItemId,
            xml_line_identity,
            motor_version: motorVersion,
            outcome: {
              product_id: productId,
              resolution: resolutionLabel,
              import_resolution_status:
                unitConflictAutoLinked && productId
                  ? "AUTO_MATCH"
                  : (batchFinalize.import_resolution_status as string | null),
              match_score: batchFinalize.match_score ?? null,
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "company_id,expense_id,xml_line_identity,motor_version" },
        );

        if (rq?.should_queue) {
          const pmCompact = (rq.pm_compact ?? {}) as Record<string, unknown>;
          const suggestedCatalogName = rq.suggested_catalog_name == null
            ? null
            : String(rq.suggested_catalog_name);
          const raw_xml_name = String(rq.raw_xml_name ?? "").trim() || "Item";
          const candidateProductIds = Array.isArray(rq.candidate_product_ids)
            ? (rq.candidate_product_ids as unknown[]).map((x) => String(x)).filter(Boolean)
            : [];
          const copy = batchImportReviewPendingTitleDetail({
            productName: raw_xml_name,
            pm: pmCompact,
            missingProduct: !String(productId ?? "").trim(),
            suggestedCatalogName,
          });
          motorReviewRowsFin.push({
            company_id: companyId,
            batch_id: ctx.import_job_batch_id,
            file_id: ctx.import_job_file_id,
            expense_id: expenseId,
            expense_item_id: expenseItemId,
            kind: "missing_product_match",
            status: "OPEN",
            title: copy.title,
            detail: copy.detail,
            payload: {
              reason_code: copy.reason_code,
              xml_line_identity,
              motor_version: motorVersion,
              product_match: compactProductMatchForPendingPayload(pmCompact),
              xml_product_name: raw_xml_name,
              suggested_catalog_name: suggestedCatalogName || null,
              candidate_product_ids: candidateProductIds,
            },
          });
        }
      }

      linesOutFin.push({
        expense_item_id: expenseItemId,
        raw_import_id,
        xml_line_identity,
        resolution: resolutionLabel,
        product_id: productId,
        confidence: batchFinalize.match_score != null ? Number(batchFinalize.match_score) : null,
        reasons_json: {
          finalize_after_batch_insert: true,
          import_resolution_status: batchFinalize.import_resolution_status ?? null,
        },
      });
    }

    await runNfeMotorApplyTail(supabase, {
      companyId,
      expenseId,
      financial,
      motorReviewRows: motorReviewRowsFin,
    });

    return {
      ok: errors.length === 0,
      expense_id: expenseId,
      lines: linesOutFin,
      financial,
      errors: errors.length ? errors : undefined,
    };
  }

  /** Mesmas opções que `PREVIEW_FULL` no laboratório (importBatch + LLM + embeddings). */
  const matchResult = await matchNfeExpenseCatalogLines(
    supabase,
    companyId,
    ctx.items,
    "XML_BATCH_OR_LAB",
  );

  const linesOut: NfeExpenseProductsResultLine[] = [];
  const motorReviewRows: Array<Record<string, unknown>> = [];

  /** Nomes de catálogo para exibir em `expense_items.product_name` após vínculo (paridade com dev-preview). */
  const catalogNameById = new Map<string, string>();
  if (mode === "apply") {
    const candidateIds = new Set<string>();
    const minAuto = DEFAULT_IMPORT_MATCH_THRESHOLDS.autoMatchMinScore;
    for (let j = 0; j < ctx.items.length; j += 1) {
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
        .select("id, name")
        .eq("company_id", companyId)
        .in("id", [...candidateIds]);
      for (const r of prodRows ?? []) {
        const id = String((r as { id?: string }).id ?? "").trim();
        const nm = String((r as { name?: string }).name ?? "").trim();
        if (id && nm) catalogNameById.set(id, nm);
      }
    }
  }

  for (let i = 0; i < ctx.items.length; i += 1) {
    const lineItem = matchResult.items[i] as ItemWithProductMatch | undefined;
    const pm = lineItem?.productMatch;
    const expenseItemId = expenseItemIds[i] ?? "";
    const xml_line_identity = ctx.xml_line_identities[i] ?? `nItem:${i + 1}:cProd:x`;
    const rawRow = ctx.raw_rows_ordered[i];
    const raw_import_id =
      rawRow?.id && String(rawRow.id).trim() ? String(rawRow.id) : null;

    if (!expenseItemId) {
      linesOut.push({
        expense_item_id: "",
        raw_import_id,
        xml_line_identity,
        resolution: "SKIPPED",
        product_id: null,
        confidence: pm?.suggestedScore ?? null,
        reasons_json: { error: "expense_item em falta para este índice" },
      });
      continue;
    }

    let productId =
      String(pm?.resolvedProductId ?? "").trim() ||
      (
        pm?.resolutionStatus === "AUTO_MATCH"
          ? String(pm?.suggestedProductId ?? "").trim()
          : ""
      ) ||
      null;
    let unitConflictAutoLinked = false;
    if (!productId && pm) {
      const sid = String(pm.suggestedProductId ?? "").trim();
      const score = Number(pm.suggestedScore ?? 0);
      const minAuto = DEFAULT_IMPORT_MATCH_THRESHOLDS.autoMatchMinScore;
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
    const alreadyLinkedPid = existingProductIds[i] ?? null;

    if (mode === "apply") {
      if (alreadyLinkedPid) {
        productId = alreadyLinkedPid;
        createdNew = false;
        unitConflictAutoLinked = false;
      } else if (pm) {
        const ensured = await ensureProductForLine(
          supabase,
          companyId,
          ctx.items[i]!,
          pm,
        );
        if (!productId && ensured.productId) {
          productId = ensured.productId;
          createdNew = ensured.created;
        }
      }

      let resolutionLabel: NfeCatalogLineResolution = alreadyLinkedPid
        ? "AUTO_MATCH"
        : mapResolution(pm, createdNew);
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

      const rawXmlName = String(ctx.items[i]?.productName ?? "").trim() || "Item";
      const strippedDisplay =
        stripPackSizeFromLabel(rawXmlName).trim() || rawXmlName;

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
          ctx.items[i]!,
          pm,
        );
        if (fb.productId) {
          productId = fb.productId;
          if (fb.created) {
            createdNew = true;
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

      /** Onboarding ZIP: com produto resolvido, liberta `import_pending_resolution` para a entrada automática de stock, mantendo `import_review_pending` quando `needsCatalogReview`. */
      const onboardingXmlLine = Boolean(raw_import_id);
      const importPendingResolution =
        onboardingXmlLine && String(productId ?? "").trim()
          ? false
          : needsCatalogReview;

      const updateRow: Record<string, unknown> = {
        import_pending_resolution: importPendingResolution,
        import_engine_suggestion: "XML_CATALOG_MOTOR_APPLIED",
        import_resolution_status:
          unitConflictAutoLinked && String(productId ?? "").trim()
            ? "AUTO_MATCH"
            : (pm?.resolutionStatus ?? null),
        match_score: pm?.suggestedScore ?? null,
        match_decision_reason: pm?.matchReason ?? null,
        invoice_unit: pickInvoiceUnitRaw(ctx.items[i] as ExtractedItemWithInvoiceMeta),
        ncm: ctx.items[i]?.ncm ?? null,
        ean: ctx.items[i]?.ean ?? null,
        import_score_reasons_json: {
          xml_catalog_motor: {
            motor_version: motorVersion,
            decision_path: pm?.decisionPath ?? null,
            borderline_llm_rationale: pm?.borderlineLlmRationale ?? null,
            resolution: resolutionLabel,
            unit_conflict_auto_linked: unitConflictAutoLinked || undefined,
            invoice_line_units_llm: pm?.invoice_line_units_llm ?? undefined,
          },
        },
        import_confidence_0_1: pm?.suggestedScore != null
          ? Math.round(Number(pm.suggestedScore) / 10) / 100
          : null,
      };

      if (productId) updateRow.product_id = productId;
      if (pm?.stockQuantity != null) updateRow.stock_quantity = pm.stockQuantity;
      if (pm?.conversionFactorApplied != null) {
        updateRow.conversion_factor_applied = pm.conversionFactorApplied;
      }
      if (pm?.resolutionSource) updateRow.resolution_source = pm.resolutionSource;
      if (pm?.invoiceUnitNormalized) {
        updateRow.normalized_invoice_unit = String(pm.invoiceUnitNormalized);
      }

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
        updateRow.product_name = catName || strippedDisplay;
      } else {
        updateRow.product_name = pm
          ? catalogRegistrationNameFromNfeLine(ctx.items[i]!, pm) ||
            strippedDisplay
          : strippedDisplay;
      }

      await supabase
        .from("expense_items")
        .update(updateRow)
        .eq("id", expenseItemId)
        .eq("expense_id", expenseId);

      if (productId) {
        await upsertProductInvoiceAlias(
          supabase,
          companyId,
          String(ctx.items[i]?.productName ?? "").trim() || "Item",
          productId,
        );
      }

      if (raw_import_id && productId) {
        await supabase
          .from("onboarding_import_item_raw")
          .update({
            created_product_id: productId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", raw_import_id)
          .eq("company_id", companyId);
      }

      await supabase.from("expense_xml_item_motor_pass").upsert(
        {
          company_id: companyId,
          expense_id: expenseId,
          expense_item_id: expenseItemId,
          xml_line_identity,
          motor_version: motorVersion,
          outcome: {
            product_id: productId,
            resolution: resolutionLabel,
            import_resolution_status:
              unitConflictAutoLinked && String(productId ?? "").trim()
                ? "AUTO_MATCH"
                : (pm?.resolutionStatus ?? null),
            match_score: pm?.suggestedScore ?? null,
          },
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "company_id,expense_id,xml_line_identity,motor_version",
        },
      );

      if (needsCatalogReview && shouldQueue) {
        const suggestedCatalogName = pm
          ? catalogRegistrationNameFromNfeLine(ctx.items[i]!, pm)
          : "";
        const candidateProductIds = [
          String(pm?.suggestedProductId ?? "").trim(),
        ].filter(Boolean);
        const copy = batchImportReviewPendingTitleDetail({
          productName: rawXmlName,
          pm: pmRecord,
          missingProduct: !String(productId ?? "").trim(),
          suggestedCatalogName: suggestedCatalogName || null,
        });
        motorReviewRows.push({
          company_id: companyId,
          batch_id: ctx.import_job_batch_id,
          file_id: ctx.import_job_file_id,
          expense_id: expenseId,
          expense_item_id: expenseItemId,
          kind: "missing_product_match",
          status: "OPEN",
          title: copy.title,
          detail: copy.detail,
          payload: {
            reason_code: copy.reason_code,
            xml_line_identity,
            motor_version: motorVersion,
            product_match: compactProductMatchForPendingPayload(pmRecord),
            xml_product_name: rawXmlName,
            suggested_catalog_name: suggestedCatalogName || null,
            candidate_product_ids: candidateProductIds,
          },
        });
      }

      linesOut.push({
        expense_item_id: expenseItemId,
        raw_import_id,
        xml_line_identity,
        resolution: resolutionLabel,
        product_id: productId,
        confidence: pm?.suggestedScore ?? null,
        reasons_json: {
          resolutionStatus: pm?.resolutionStatus ?? null,
          needsConfirmation: pm?.needsConfirmation ?? null,
          decisionPath: pm?.decisionPath ?? null,
        },
      });
    } else {
      const dryResolution: NfeCatalogLineResolution =
        unitConflictAutoLinked && String(productId ?? "").trim()
          ? "AUTO_MATCH"
          : mapResolution(pm, false);
      linesOut.push({
        expense_item_id: expenseItemId,
        raw_import_id,
        xml_line_identity,
        resolution: dryResolution,
        product_id:
          String(productId ?? "").trim() ||
          String(pm?.resolvedProductId ?? "").trim() ||
          String(pm?.suggestedProductId ?? "").trim() ||
          null,
        confidence: pm?.suggestedScore ?? null,
        reasons_json: {
          resolutionStatus: pm?.resolutionStatus ?? null,
          needsConfirmation: pm?.needsConfirmation ?? null,
          decisionPath: pm?.decisionPath ?? null,
          unit_conflict_auto_linked_preview: unitConflictAutoLinked || undefined,
        },
      });
    }
  }

  if (mode === "apply") {
    await runNfeMotorApplyTail(supabase, {
      companyId,
      expenseId,
      financial,
      motorReviewRows,
    });
  }

  return {
    ok: errors.length === 0,
    expense_id: expenseId,
    lines: linesOut,
    financial,
    errors: errors.length ? errors : undefined,
  };
}

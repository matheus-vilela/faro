/**
 * Handler pesado (productMatch, parse XML, IA). Carregado via import() dinâmico
 * para o worker arrancar em OPTIONS sem avaliar este grafo (evita BOOT_ERROR).
 */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { enrichExtractedWithTaxId } from "../_shared/expenseSupplierEnsure.ts";
import type { ExtractedDocumentResult } from "../_shared/openaiExpense.ts";
import {
  massPerCountUnitFromLabelKg,
  packSizeFromLabel,
  stripPackSizeFromLabel,
} from "../_shared/productImport/packSizeFromLabel.ts";
import { pickInvoiceUnitRaw } from "../_shared/productImport/consolidateItems.ts";
import { parseNfeXmlToExtracted } from "../_shared/parseNfeXml.ts";
import {
  resolveProductMatches,
  type ItemWithProductMatch,
} from "../received-whatsapp-message/productMatch.ts";
import { normalizeUnitAliasKey } from "../_shared/productImport/unitNormalize.ts";
import { corsHeaders } from "./cors.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

const CATALOG_PREVIEW_LIMIT = 50;

function envLineUnitsAiMaxCalls(): number {
  try {
    const raw = Deno.env.get("LINE_UNITS_AI_MAX_PER_PREVIEW") ?? "8";
    const n = Number.parseInt(String(raw), 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 40) : 8;
  } catch {
    return 8;
  }
}

function envLineUnitsAutoConfidenceThreshold(): number {
  try {
    const raw = Deno.env.get("LINE_UNITS_AI_AUTO_CONFIDENCE_THRESHOLD") ?? "0.92";
    const n = Number.parseFloat(String(raw));
    if (!Number.isFinite(n)) return 0.92;
    return Math.max(0.5, Math.min(0.999, n));
  } catch {
    return 0.92;
  }
}

function envLineUnitsAiConcurrency(): number {
  try {
    const raw = Deno.env.get("LINE_UNITS_AI_CONCURRENCY") ?? "4";
    const n = Number.parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < 1) return 4;
    return Math.min(n, 8);
  } catch {
    return 4;
  }
}

async function mapWithConcurrency<T, R>(
  arr: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const ret: R[] = new Array(arr.length);
  let next = 0;
  const workerCount = Math.min(Math.max(1, limit), arr.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = next++;
      if (i >= arr.length) break;
      ret[i] = await mapper(arr[i]!, i);
    }
  });
  await Promise.all(workers);
  return ret;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function attachPreviewLineSimulation(items: ItemWithProductMatch[]) {
  return items.map((it) => {
    const rawQty = Number(it.quantity);
    const lineTotal = Number(it.lineTotal);
    const { packFactor, rationale } = packSizeFromLabel(it.productName);
    const rawName = String(it.productName ?? "").trim() || "Item";
    const catalogNameForRegistration =
      stripPackSizeFromLabel(rawName).trim() || rawName;
    const massPerPackageKg = massPerCountUnitFromLabelKg(rawName);
    const impliedTotalMassKg =
      massPerPackageKg != null && massPerPackageKg > 0
        ? Math.round(rawQty * massPerPackageKg * 1e6) / 1e6
        : null;
    const factor =
      packFactor != null && packFactor >= 2 ? packFactor : null;
    const quantityAdjusted =
      factor != null
        ? Math.round(rawQty * factor * 1e6) / 1e6
        : Math.round(rawQty * 1e6) / 1e6;
    const unitValueAdjusted =
      quantityAdjusted > 0 && Number.isFinite(lineTotal)
        ? Math.round((lineTotal / quantityAdjusted) * 1e4) / 1e4
        : Number(it.unitValue);
    return {
      ...it,
      _preview_line_simulation: {
        packFactor: factor,
        packRationale: factor != null ? rationale : null,
        catalogNameForRegistration,
        massPerPackageKg,
        impliedTotalMassKg,
        rawQuantity: rawQty,
        quantityAdjusted,
        unitValueAdjusted,
        lineTotal: Number.isFinite(lineTotal) ? lineTotal : null,
        invoiceUnitRaw: pickInvoiceUnitRaw(it),
      },
    };
  });
}

type PreviewItem = Record<string, unknown> & {
  productMatch?: Record<string, unknown>;
};

async function attachLineUnitsAiPreview(
  items: PreviewItem[],
  params: {
    supabase: SupabaseClient;
    companyId: string;
    openaiKey: string;
    openaiModel: string;
  },
): Promise<{
  items: PreviewItem[];
  callsMade: number;
  maxPerPreview: number;
  autoThreshold: number;
  concurrency: number;
}> {
  const {
    assistInvoiceLineUnits,
    validateInvoiceLineUnitsNumeric,
    lineUnitsWouldSubstituteStock,
  } = await import("../_shared/productImport/invoiceLineUnitsLlmAssist.ts");

  async function processOneLineUnitsAi(
    it: PreviewItem,
    ctx: {
      openaiKey: string;
      openaiModel: string;
      catalogUnitsDistinct: string[];
      productUnitById: Map<string, string>;
      companyUnitAliasNormKeyToCode: Record<string, string>;
      autoThreshold: number;
    },
  ): Promise<PreviewItem> {
    const pm = it.productMatch as Record<string, unknown> | undefined;
    const suggestedName = pm?.suggestedProductName
      ? String(pm.suggestedProductName)
      : null;
    const sid = pm?.suggestedProductId
      ? String(pm.suggestedProductId)
      : null;
    const matchedUnit = sid ? (ctx.productUnitById.get(sid) ?? null) : null;

    const rawName = String(it.productName ?? "").trim() || "Item";
    const uCom = it.unitCommercial != null ? String(it.unitCommercial) : null;
    const uTrib = it.unitTax != null ? String(it.unitTax) : null;
    const qty = Number(it.quantity);
    const uv = Number(it.unitValue);
    const lt = Number(it.lineTotal);

    const assist = await assistInvoiceLineUnits(
      ctx.openaiKey,
      ctx.openaiModel,
      {
        product_name: rawName,
        unit_commercial: uCom,
        unit_tax: uTrib,
        quantity: qty,
        unit_value: uv,
        line_total: lt,
        matched_catalog_unit: matchedUnit,
        matched_product_name: suggestedName,
        catalog_units_distinct: ctx.catalogUnitsDistinct,
        company_unit_alias_norm_key_to_code: ctx.companyUnitAliasNormKeyToCode,
      },
    );

    if (assist.kind === "ERROR") {
      return {
        ...it,
        _preview_line_ai_units: {
          kind: "ERROR",
          message: assist.message,
          auto_confidence_threshold: ctx.autoThreshold,
        },
      };
    }
    if (assist.kind === "SKIP") {
      return {
        ...it,
        _preview_line_ai_units: {
          kind: "SKIP",
          rationale: assist.rationale,
          auto_confidence_threshold: ctx.autoThreshold,
        },
      };
    }

    const numeric = validateInvoiceLineUnitsNumeric({
      quantity: qty,
      unit_value: uv,
      line_total: lt,
      stock_quantity_suggested: assist.stock_quantity_suggested,
      conversion_factor_per_invoice_unit:
        assist.conversion_factor_per_invoice_unit,
    });

    const wouldSubstitute = lineUnitsWouldSubstituteStock({
      confidence: assist.confidence,
      autoConfidenceThreshold: ctx.autoThreshold,
      numericOk: numeric.ok,
    });

    return {
      ...it,
      _preview_line_ai_units: {
        kind: "OK",
        cleaned_product_name: assist.cleaned_product_name,
        interpretation: assist.interpretation,
        stock_quantity_suggested: assist.stock_quantity_suggested,
        conversion_factor_per_invoice_unit:
          assist.conversion_factor_per_invoice_unit,
        catalog_unit_target: assist.catalog_unit_target,
        invoice_unit_raw: assist.invoice_unit_raw,
        catalog_unit_needs_review: assist.catalog_unit_needs_review,
        confidence: assist.confidence,
        numeric_validation_ok: numeric.ok,
        numeric_validation_reasons: numeric.reasons,
        would_substitute_stock: wouldSubstitute,
        auto_confidence_threshold: ctx.autoThreshold,
      },
    };
  }

  const maxCalls = envLineUnitsAiMaxCalls();
  const autoThreshold = envLineUnitsAutoConfidenceThreshold();
  const concurrency = envLineUnitsAiConcurrency();

  const { data: unitRows } = await params.supabase
    .from("products")
    .select("unit")
    .eq("company_id", params.companyId)
    .eq("is_active", true)
    .not("unit", "is", null)
    .limit(800);

  const catalogUnitsDistinct = [
    ...new Set(
      (unitRows ?? []).map((r: { unit: string }) => String(r.unit ?? "").trim())
        .filter(Boolean),
    ),
  ].sort().slice(0, 48);

  const suggestedIds = [
    ...new Set(
      items
        .map((it) => {
          const sid = it.productMatch?.["suggestedProductId"];
          return sid != null ? String(sid).trim() : "";
        })
        .filter(Boolean),
    ),
  ];

  const productUnitById = new Map<string, string>();
  if (suggestedIds.length > 0) {
    const { data: prows } = await params.supabase
      .from("products")
      .select("id, unit")
      .eq("company_id", params.companyId)
      .in("id", suggestedIds);
    for (const r of (prows ?? []) as Array<{ id: string; unit: string | null }>) {
      if (r.unit) productUnitById.set(r.id, String(r.unit));
    }
  }

  const { data: companyUnitAliasRows, error: cuaErr } = await params.supabase
    .from("company_custom_unit_aliases")
    .select("unit_code, unit_label, source_hint")
    .eq("company_id", params.companyId);

  if (cuaErr) {
    console.warn(
      "[dev-preview-nfe-xml] company_custom_unit_aliases:",
      cuaErr.message,
    );
  }

  const companyUnitAliasNormKeyToCode: Record<string, string> = {};
  for (const row of (companyUnitAliasRows ?? []) as Array<{
    unit_code: string;
    unit_label: string;
    source_hint: string | null;
  }>) {
    const code = String(row.unit_code ?? "").trim();
    if (!code) continue;
    const kl = normalizeUnitAliasKey(row.unit_label);
    if (kl) companyUnitAliasNormKeyToCode[kl] = code;
    const kh = row.source_hint ? normalizeUnitAliasKey(row.source_hint) : "";
    if (kh) companyUnitAliasNormKeyToCode[kh] = code;
  }

  const ctx = {
    openaiKey: params.openaiKey,
    openaiModel: params.openaiModel,
    catalogUnitsDistinct,
    productUnitById,
    companyUnitAliasNormKeyToCode,
    autoThreshold,
  };

  const head = items.slice(0, maxCalls);
  const tail = items.slice(maxCalls);

  const processedHead = await mapWithConcurrency(
    head,
    concurrency,
    (it) => processOneLineUnitsAi(it, ctx),
  );

  const processedTail = tail.map((it) => ({
    ...it,
    _preview_line_ai_units: {
      skipped: true,
      reason: "Limite LINE_UNITS_AI_MAX_PER_PREVIEW atingido",
      auto_confidence_threshold: autoThreshold,
    },
  }));

  return {
    items: [...processedHead, ...processedTail],
    callsMade: head.length,
    maxPerPreview: maxCalls,
    autoThreshold,
    concurrency,
  };
}

async function enrichPreviewOnly(
  supabase: SupabaseClient,
  companyId: string,
  extracted: ExtractedDocumentResult,
  simulateImportBatch: boolean,
): Promise<{
  data: ExtractedDocumentResult & { _requiresProductConfirmation?: boolean };
  matchMeta: {
    deferProductCreationToReconciliation: boolean;
    borderlineLlmCalls: number;
    requiresProductConfirmation: boolean;
  } | null;
}> {
  const ex0 = enrichExtractedWithTaxId(extracted);
  const intent = ex0.businessIntent ?? "compra_insumos";
  if (intent === "conta_pagar" || intent === "conta_receber") {
    return {
      data: {
        ...ex0,
        items: ex0.items ?? [],
        _requiresProductConfirmation: false,
      },
      matchMeta: null,
    };
  }
  const matchOpts = simulateImportBatch ? { importBatch: true } : undefined;
  const matchResult = await resolveProductMatches(
    supabase,
    companyId,
    ex0.items ?? [],
    matchOpts,
  );
  const itemsWithSim = attachPreviewLineSimulation(matchResult.items);
  return {
    data: {
      ...ex0,
      items: itemsWithSim,
      _requiresProductConfirmation: matchResult.requiresProductConfirmation,
    },
    matchMeta: {
      deferProductCreationToReconciliation:
        matchResult.deferProductCreationToReconciliation,
      borderlineLlmCalls: matchResult.borderlineLlmCalls,
      requiresProductConfirmation: matchResult.requiresProductConfirmation,
    },
  };
}

export async function handleDevPreview(input: {
  supabase: SupabaseClient;
  companyId: string;
  fileName: string;
  xmlText: string;
  simulateImportBatch: boolean;
  aiLineUnitsPreview: boolean;
}): Promise<Response> {
  const raw = parseNfeXmlToExtracted(input.xmlText);
  if (!raw) {
    return json({
      ok: false,
      error:
        "Não foi possível ler NF-e neste XML. Confirme que é nfeProc/NFe autorizada com itens.",
    }, 422);
  }

  const { data: enriched, matchMeta } = await enrichPreviewOnly(
    input.supabase,
    input.companyId,
    raw,
    input.simulateImportBatch,
  );

  const { data: catalogRows } = await input.supabase
    .from("products")
    .select("id, name, unit")
    .eq("company_id", input.companyId)
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(CATALOG_PREVIEW_LIMIT + 1);

  const catalogList = catalogRows ?? [];
  const catalogTruncated = catalogList.length > CATALOG_PREVIEW_LIMIT;
  const catalog_preview = {
    items: catalogList
      .slice(0, CATALOG_PREVIEW_LIMIT)
      .map((p: { id: string; name: string; unit: string | null }) => ({
        id: p.id,
        name: p.name,
        unit: p.unit,
      })),
    truncated: catalogTruncated,
    limit: CATALOG_PREVIEW_LIMIT,
  };

  let enrichedPayload = enriched;
  let line_units_ai: Record<string, unknown> | null = null;

  if (input.aiLineUnitsPreview) {
    const items = (enriched.items ?? []) as PreviewItem[];
    const openaiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
    const openaiModel =
      Deno.env.get("OPENAI_PRODUCT_MATCH_MODEL") ?? "gpt-4o-mini";
    const openaiConfigured = openaiKey.length > 0;
    if (!openaiConfigured) {
      line_units_ai = {
        enabled: true,
        openai_api_key_configured: false,
        skipped: true,
        reason:
          "OPENAI_API_KEY ausente. Defina o secret na função (Dashboard → Edge Functions → dev-preview-nfe-xml → Secrets, ou `supabase secrets set OPENAI_API_KEY=...`).",
      };
    } else if (items.length === 0) {
      line_units_ai = {
        enabled: true,
        openai_api_key_configured: true,
        skipped: true,
        reason: "Sem linhas de itens neste documento.",
      };
    } else {
      const r = await attachLineUnitsAiPreview(items, {
        supabase: input.supabase,
        companyId: input.companyId,
        openaiKey,
        openaiModel,
      });
      enrichedPayload = { ...enriched, items: r.items };
      line_units_ai = {
        enabled: true,
        openai_api_key_configured: true,
        calls_made: r.callsMade,
        max_per_preview: r.maxPerPreview,
        concurrency: r.concurrency,
        auto_confidence_threshold: r.autoThreshold,
        note:
          "Substituição automática de stock só quando confidence ≥ limiar E validação numérica OK (laboratório; importação real ainda não usa). Chamadas OpenAI em paralelo (LINE_UNITS_AI_CONCURRENCY).",
      };
    }
  }

  return json({
    ok: true,
    dry_run: true,
    simulate_import_batch: input.simulateImportBatch,
    ai_line_units_preview: input.aiLineUnitsPreview,
    line_units_ai,
    defer_product_creation_to_reconciliation:
      matchMeta?.deferProductCreationToReconciliation ?? null,
    borderline_llm_calls: matchMeta?.borderlineLlmCalls ?? null,
    catalog_preview,
    file_name: input.fileName || "nota.xml",
    raw,
    enriched: enrichedPayload,
    hint:
      "Extração XML é determinística (parseNfeXml). «enriched» inclui matching de produtos sem criar fornecedor. Com simulate_import_batch, o matching segue o mesmo modo da importação em lote. Com ai_line_units_preview, cada linha pode incluir _preview_line_ai_units (OpenAI).",
  });
}

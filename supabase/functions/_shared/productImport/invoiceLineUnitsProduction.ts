/**
 * Produção / preview full: aplica `assistInvoiceLineUnits` às linhas após `resolveProductMatches`,
 * enriquecendo `productMatch` (nome sugerido, unidade alvo, trilho de auditoria).
 */

import type { ItemWithProductMatch } from "../../received-whatsapp-message/productMatch.ts";
import {
  assistInvoiceLineUnits,
  lineUnitsWouldSubstituteStock,
  validateInvoiceLineUnitsNumeric,
} from "./invoiceLineUnitsLlmAssist.ts";
import { stripTrailingPackagingQtyAndUnitsForCatalogName } from "./canonicalName.ts";
import { normalizeUnitAliasKey } from "./unitNormalize.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

function envLineUnitsAiMaxPerInvocation(): number {
  try {
    const raw =
      typeof Deno !== "undefined"
        ? Deno.env.get("LINE_UNITS_AI_MAX_PER_INVOCATION") ??
          Deno.env.get("LINE_UNITS_AI_MAX_PER_PREVIEW") ??
          "40"
        : "40";
    const n = Number.parseInt(String(raw), 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 120) : 40;
  } catch {
    return 40;
  }
}

function envLineUnitsAiConcurrency(): number {
  try {
    const raw =
      typeof Deno !== "undefined"
        ? Deno.env.get("LINE_UNITS_AI_CONCURRENCY") ?? "4"
        : "4";
    const n = Number.parseInt(String(raw), 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 12) : 4;
  } catch {
    return 4;
  }
}

function envLineUnitsAutoConfidenceThreshold(): number {
  try {
    const raw =
      typeof Deno !== "undefined"
        ? Deno.env.get("LINE_UNITS_AI_AUTO_CONFIDENCE_THRESHOLD") ?? "0.92"
        : "0.92";
    const n = Number.parseFloat(String(raw));
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.92;
  } catch {
    return 0.92;
  }
}

function envLineUnitsApplyNameMinConfidence(): number {
  try {
    const raw =
      typeof Deno !== "undefined"
        ? Deno.env.get("LINE_UNITS_AI_APPLY_NAME_MIN_CONFIDENCE") ?? "0.65"
        : "0.65";
    const n = Number.parseFloat(String(raw));
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.65;
  } catch {
    return 0.65;
  }
}

async function mapWithConcurrency<T, R>(
  arr: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const ret: R[] = new Array(arr.length);
  let next = 0;
  const workerCount = Math.min(Math.max(1, limit), Math.max(1, arr.length));
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

type LineUnitsCtx = {
  openaiKey: string;
  openaiModel: string;
  catalogUnitsDistinct: string[];
  productUnitById: Map<string, string>;
  companyUnitAliasNormKeyToCode: Record<string, string>;
  autoThreshold: number;
  nameMinConfidence: number;
};

function mergeProductMatchWithLineUnits(
  prev: NonNullable<ItemWithProductMatch["productMatch"]>,
  assist: Awaited<ReturnType<typeof assistInvoiceLineUnits>>,
  ctx: LineUnitsCtx,
  qty: number,
  uv: number,
  lt: number,
): NonNullable<ItemWithProductMatch["productMatch"]> {
  if (assist.kind === "ERROR") {
    return {
      ...prev,
      invoice_line_units_llm: {
        kind: "ERROR",
        message: assist.message,
      },
    };
  }
  if (assist.kind === "SKIP") {
    return {
      ...prev,
      invoice_line_units_llm: {
        kind: "SKIP",
        rationale: assist.rationale,
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

  const snapshot = {
    kind: "OK" as const,
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
  };

  let borderlineLlmSuggestedName = prev.borderlineLlmSuggestedName;
  const cleaned = stripTrailingPackagingQtyAndUnitsForCatalogName(
    assist.cleaned_product_name.trim(),
  ).trim();
  if (cleaned && assist.confidence >= ctx.nameMinConfidence) {
    borderlineLlmSuggestedName = cleaned;
  }

  return {
    ...prev,
    invoice_line_units_llm: snapshot,
    borderlineLlmSuggestedName,
  };
}

async function processOneItem(
  item: ItemWithProductMatch,
  ctx: LineUnitsCtx,
): Promise<ItemWithProductMatch> {
  const pm = item.productMatch;
  if (!pm) return item;

  const suggestedName = pm.suggestedProductName
    ? String(pm.suggestedProductName)
    : null;
  const sid =
    String(pm.resolvedProductId ?? "").trim() ||
    String(pm.suggestedProductId ?? "").trim() ||
    "";
  const matchedUnit = sid ? (ctx.productUnitById.get(sid) ?? null) : null;

  const rawName = String(item.productName ?? "").trim() || "Item";
  const uCom = item.unitCommercial != null ? String(item.unitCommercial) : null;
  const uTrib = item.unitTax != null ? String(item.unitTax) : null;
  const qty = Number(item.quantity);
  const qtyCom = Number(
    (item as { quantityCommercial?: number }).quantityCommercial ?? qty,
  );
  const qtyTrib = Number(
    (item as { quantityTax?: number }).quantityTax ?? 0,
  );
  const uv = Number(item.unitValue);
  const lt = Number(item.lineTotal);

  const assist = await assistInvoiceLineUnits(ctx.openaiKey, ctx.openaiModel, {
    product_name: rawName,
    unit_commercial: uCom,
    unit_tax: uTrib,
    quantity: qty,
    quantity_commercial: qtyCom > 0 ? qtyCom : qty,
    quantity_tax: qtyTrib > 0 ? qtyTrib : null,
    unit_value: uv,
    line_total: lt,
    matched_catalog_unit: matchedUnit,
    matched_product_name: suggestedName,
    catalog_units_distinct: ctx.catalogUnitsDistinct,
    company_unit_alias_norm_key_to_code: ctx.companyUnitAliasNormKeyToCode,
  });

  return {
    ...item,
    productMatch: mergeProductMatchWithLineUnits(pm, assist, ctx, qty, uv, lt),
  };
}

export async function applyInvoiceLineUnitsAssistToItems(params: {
  supabase: SupabaseClient;
  companyId: string;
  items: ItemWithProductMatch[];
}): Promise<{ items: ItemWithProductMatch[]; lineUnitsLlmCalls: number }> {
  const { supabase, companyId, items } = params;
  const openaiKey = (typeof Deno !== "undefined"
    ? Deno.env.get("OPENAI_API_KEY") ?? ""
    : "").trim();
  if (!openaiKey || items.length === 0) {
    return { items, lineUnitsLlmCalls: 0 };
  }

  const openaiModel =
    (typeof Deno !== "undefined"
      ? Deno.env.get("OPENAI_PRODUCT_MATCH_MODEL") ?? "gpt-4o-mini"
      : "gpt-4o-mini") as string;

  const maxCalls = envLineUnitsAiMaxPerInvocation();
  const concurrency = envLineUnitsAiConcurrency();
  const autoThreshold = envLineUnitsAutoConfidenceThreshold();
  const nameMinConfidence = envLineUnitsApplyNameMinConfidence();

  const { data: unitRows } = await supabase
    .from("products")
    .select("unit")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .not("unit", "is", null)
    .limit(800);

  const catalogUnitsDistinct = Array.from(
    new Set(
      (unitRows ?? [])
        .map((r: { unit: string }) => String(r.unit ?? "").trim())
        .filter((u): u is string => u.length > 0),
    ),
  )
    .sort()
    .slice(0, 48);

  const suggestedIds = [
    ...new Set(
      items
        .map((it) => {
          const pm = it.productMatch;
          const r = String(pm?.resolvedProductId ?? "").trim();
          const s = String(pm?.suggestedProductId ?? "").trim();
          return r || s || "";
        })
        .filter(Boolean),
    ),
  ];

  const productUnitById = new Map<string, string>();
  if (suggestedIds.length > 0) {
    const { data: prows } = await supabase
      .from("products")
      .select("id, unit")
      .eq("company_id", companyId)
      .in("id", suggestedIds);
    for (const r of (prows ?? []) as Array<{ id: string; unit: string | null }>) {
      if (r.unit) productUnitById.set(r.id, String(r.unit));
    }
  }

  const { data: companyUnitAliasRows, error: cuaErr } = await supabase
    .from("company_custom_unit_aliases")
    .select("unit_code, unit_label, source_hint")
    .eq("company_id", companyId);

  if (cuaErr) {
    console.warn(
      "[invoiceLineUnitsProduction] company_custom_unit_aliases:",
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

  const ctx: LineUnitsCtx = {
    openaiKey,
    openaiModel,
    catalogUnitsDistinct,
    productUnitById,
    companyUnitAliasNormKeyToCode,
    autoThreshold,
    nameMinConfidence,
  };

  const head = items.slice(0, maxCalls);
  const tail = items.slice(maxCalls);

  const processedHead = await mapWithConcurrency(
    head,
    concurrency,
    (it) => processOneItem(it, ctx),
  );

  const processedTail = tail.map((it) => {
    if (!it.productMatch) return it;
    return {
      ...it,
      productMatch: {
        ...it.productMatch,
        invoice_line_units_llm: {
          kind: "SKIPPED",
          reason: "LINE_UNITS_AI_MAX_PER_INVOCATION",
          auto_confidence_threshold: autoThreshold,
        },
      },
    };
  });

  const callsMade = head.filter((it) => it.productMatch).length;

  return {
    items: [...processedHead, ...processedTail],
    lineUnitsLlmCalls: callsMade,
  };
}

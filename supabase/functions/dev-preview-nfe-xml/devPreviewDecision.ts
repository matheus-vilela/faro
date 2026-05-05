/**
 * Decisões estruturadas para o laboratório `dev-preview-nfe-xml` apenas.
 * Não integrar em importação em lote ou outros fluxos até evolução explícita do produto.
 */

import {
  conversionFactorToA,
  normalizeUnitLabel,
  unitsAreConvertible,
  unitsAreEqual,
  type NormalizedUnitCode,
} from "../_shared/productImport/unitNormalize.ts";
import {
  clampThresholds,
  DEFAULT_IMPORT_MATCH_THRESHOLDS,
  type ImportMatchThresholds,
} from "../_shared/productImport/matchConfig.ts";
import type { ImportItemResolutionStatus } from "../_shared/productImport/resolutionStatus.ts";

export type SuggestedConversionShape = {
  primary_qty: number;
  primary_unit_code: string;
  secondary_qty: number;
  secondary_unit_code: string;
  relation: string;
  derived_standard?: Array<{ unit_code: string; qty_for_1_un: number }>;
};

export type RecipeEvidence = {
  /** Produto é saída de alguma receita ativa. */
  is_recipe_output: boolean;
  /** Produto aparece como ingrediente em alguma receita. */
  is_recipe_ingredient: boolean;
  /** `product_operational_config.linked_entry_breakdown_recipe_id` preenchido. */
  has_operational_recipe_link: boolean;
};

export type PreviewLineDecision = {
  match_reuse: {
    reused_existing_product: boolean;
    reused_product_id: string | null;
    blocked_new_product_suggestion: boolean;
    /** Alinhado a import batch: novo produto será criado sem pendência de match. */
    planned_auto_catalog_create?: boolean;
    suggested_new_catalog_name?: string | null;
  };
  conversion_plan: {
    preserved_primary_unit: string;
    missing_conversions_to_create: SuggestedConversionShape[];
    existing_conversions_summary: string[];
  };
  cost_suggestion: {
    unit_cost_in_primary: number | null;
    quantity_in_primary: number | null;
    line_total_check_ok: boolean;
    calculation_trace: string;
  };
  manual_review: {
    required: boolean;
    status: "REVIEW_REQUIRED" | "OK";
    reason_codes: string[];
    recommended_actions: string[];
  };
  /** Garantia de escopo: consumidores externos não devem tratar como regra global. */
  scope: "dev_preview_only";
};

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Limiares usados no preview quando não há linha em `company_product_import_settings`. */
export function previewDefaultThresholds(): ImportMatchThresholds {
  return clampThresholds(DEFAULT_IMPORT_MATCH_THRESHOLDS);
}

/**
 * Heurística leve para destacar itens que podem ser ficha técnica / preparo (revisão humana).
 */
export function detectPossibleFichaTecnica(rawName: string): {
  hit: boolean;
  reason_codes: string[];
} {
  const n = String(rawName ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (!n) return { hit: false, reason_codes: [] };
  const reason_codes: string[] = [];
  if (/\bficha\s+tecnica\b/.test(n) || /\bft\s*[\d.]+\b/.test(n)) {
    reason_codes.push("POSSIBLE_FICHA_TECNICA_NAME");
  }
  if (/\breceita\b/.test(n) && /\b(industrial|producao|padrao|base)\b/.test(n)) {
    reason_codes.push("POSSIBLE_FICHA_TECNICA_NAME");
  }
  if (/\bbase\s+para\b/.test(n) || /\bpreparo\b/.test(n) || /\bmistura\b/.test(n)) {
    reason_codes.push("POSSIBLE_FICHA_TECNICA_NAME");
  }
  if (/\b(composto|recheio|cobertura|massa)\s+(para|de)\b/.test(n)) {
    reason_codes.push("POSSIBLE_FICHA_TECNICA_NAME");
  }
  const hit = reason_codes.length > 0;
  return { hit, reason_codes: hit ? [...new Set(reason_codes)] : [] };
}

export function buildCostSuggestion(params: {
  quantityInvoice: number;
  unitValueInvoice: number;
  lineTotal: number;
  quantityInPrimary: number | null | undefined;
}): Pick<
  PreviewLineDecision["cost_suggestion"],
  "unit_cost_in_primary" | "quantity_in_primary" | "line_total_check_ok" | "calculation_trace"
> {
  const q = Math.max(0, Number(params.quantityInvoice ?? 0));
  const uv = Number(params.unitValueInvoice);
  const lt = Number(params.lineTotal);
  const product = q > 0 && Number.isFinite(uv) ? q * uv : NaN;
  const tol = Math.max(0.05, Math.abs(lt) * 0.02);
  const line_total_check_ok =
    Number.isFinite(lt) &&
    Number.isFinite(product) &&
    Math.abs(product - lt) <= tol;

  const qtyP =
    params.quantityInPrimary != null && Number.isFinite(Number(params.quantityInPrimary))
      ? Math.max(0, Number(params.quantityInPrimary))
      : null;

  const unit_cost_in_primary =
    qtyP != null && qtyP > 0 && Number.isFinite(lt) && lt >= 0
      ? round4(lt / qtyP)
      : null;

  const calculation_trace =
    qtyP != null && qtyP > 0 && Number.isFinite(lt)
      ? `unit_cost_in_primary = line_total(${lt}) / qty_primary(${round6(qtyP)})`
      : "qty_primary ausente ou zero; custo por unidade primária não calculado";

  return {
    unit_cost_in_primary,
    quantity_in_primary: qtyP,
    line_total_check_ok,
    calculation_trace,
  };
}

/**
 * Preview com «simular importação XML (batch)»: item novo sem vínculo resolvido nem candidato
 * forte (score ≥ confirmMin) e sem `needsConfirmation` — cadastro automático, sem ruído de revisão.
 */
export function isGreenPathNewCatalogItem(
  pm: Record<string, unknown> | undefined,
  thresholds: ImportMatchThresholds,
  simulateImportBatch: boolean | undefined,
): boolean {
  if (!simulateImportBatch || !pm) return false;
  if (pm.needsConfirmation === true) return false;
  const resolved =
    pm.resolvedProductId != null && String(pm.resolvedProductId).trim() !== "";
  if (resolved) return false;
  if (String(pm.borderlineLlmSuggestedName ?? "").trim() !== "") return true;
  const score =
    pm.suggestedScore != null ? Number(pm.suggestedScore) : 0;
  const hasSuggested =
    pm.suggestedProductId != null && String(pm.suggestedProductId).trim() !== "";
  if (hasSuggested && score >= thresholds.confirmMinScore) return false;
  return true;
}

function catalogPrimaryIsUn(primaryUnitCode: string | undefined): boolean {
  const raw = String(primaryUnitCode ?? "un").trim();
  if (!raw) return true;
  return normalizeUnitLabel(raw) === "UND";
}

function pickReusedProductId(pm: Record<string, unknown> | undefined): string | null {
  if (!pm) return null;
  const r = pm.resolvedProductId != null ? String(pm.resolvedProductId).trim() : "";
  if (r) return r;
  const s = pm.suggestedProductId != null ? String(pm.suggestedProductId).trim() : "";
  return s || null;
}

export function matchReuseFromProductMatch(
  pm: Record<string, unknown> | undefined,
  thresholds: ImportMatchThresholds,
): {
  reused_existing_product: boolean;
  reused_product_id: string | null;
  blocked_new_product_suggestion: boolean;
} {
  const reused_product_id = pickReusedProductId(pm);
  const score =
    pm?.suggestedScore != null ? Number(pm.suggestedScore) : 0;
  const needsConfirmation = pm?.needsConfirmation === true;
  const status = pm?.resolutionStatus != null
    ? String(pm.resolutionStatus) as ImportItemResolutionStatus
    : "NEW_PRODUCT_STAGED";

  const resolved =
    pm?.resolvedProductId != null && String(pm.resolvedProductId).trim() !== "";

  const strongSuggested =
    !needsConfirmation &&
    reused_product_id != null &&
    score >= thresholds.autoMatchMinScore &&
    status !== "NEW_PRODUCT_STAGED";

  const reused_existing_product = resolved || strongSuggested;
  const blocked_new_product_suggestion = reused_existing_product;

  return {
    reused_existing_product,
    reused_product_id: reused_product_id ?? null,
    blocked_new_product_suggestion,
  };
}

export function buildPreviewLineDecision(params: {
  productName: string;
  quantityInvoice: number;
  unitValueInvoice: number;
  lineTotal: number;
  productMatch: Record<string, unknown> | undefined;
  unitSuggestion: {
    primary_unit_code?: string;
    suggested_conversions?: SuggestedConversionShape[];
    suggested_stock_quantity_in_primary?: number;
  } | null | undefined;
  existingConversions: Array<{
    primary_unit_code: string;
    secondary_unit_code: string;
    primary_qty?: number;
    secondary_qty?: number;
  }>;
  recipeEvidence: RecipeEvidence | null;
  thresholds?: ImportMatchThresholds;
  /** Quando true (dev-preview + simular batch), só exige revisão por match/unidade primária ≠ UN. */
  simulateImportBatch?: boolean;
}): PreviewLineDecision {
  const thresholds = params.thresholds ?? previewDefaultThresholds();
  const pm = params.productMatch;
  const greenPath = isGreenPathNewCatalogItem(
    pm,
    thresholds,
    params.simulateImportBatch,
  );
  const baseReuse = matchReuseFromProductMatch(pm, thresholds);
  const match_reuse = {
    ...baseReuse,
    planned_auto_catalog_create: greenPath,
    suggested_new_catalog_name: greenPath
      ? String(pm?.borderlineLlmSuggestedName ?? params.productName ?? "").trim() ||
        null
      : null,
  };

  const primary =
    params.unitSuggestion?.primary_unit_code != null
      ? String(params.unitSuggestion.primary_unit_code)
      : "un";

  const missing =
    Array.isArray(params.unitSuggestion?.suggested_conversions)
      ? (params.unitSuggestion!.suggested_conversions as SuggestedConversionShape[])
      : [];

  const existing_conversions_summary = params.existingConversions.map((r) => {
    const pq = r.primary_qty ?? 1;
    const sq = r.secondary_qty ?? 1;
    return `${pq} ${r.primary_unit_code} = ${sq} ${r.secondary_unit_code}`;
  });

  const stockFromMatch =
    pm?.stockQuantity != null ? Number(pm.stockQuantity) : null;
  const stockFromSuggestion =
    params.unitSuggestion?.suggested_stock_quantity_in_primary != null
      ? Number(params.unitSuggestion.suggested_stock_quantity_in_primary)
      : null;

  const quantity_in_primary =
    stockFromSuggestion != null && Number.isFinite(stockFromSuggestion)
      ? stockFromSuggestion
      : stockFromMatch != null && Number.isFinite(stockFromMatch)
        ? stockFromMatch
        : null;

  const cost_suggestion = {
    ...buildCostSuggestion({
      quantityInvoice: params.quantityInvoice,
      unitValueInvoice: params.unitValueInvoice,
      lineTotal: params.lineTotal,
      quantityInPrimary: quantity_in_primary,
    }),
  };

  const ficha = detectPossibleFichaTecnica(params.productName);
  const reason_codes: string[] = [];
  const recommended_actions: string[] = [];

  const needsConfirmation = pm?.needsConfirmation === true;
  const status = pm?.resolutionStatus != null
    ? String(pm.resolutionStatus)
    : "NEW_PRODUCT_STAGED";
  const score =
    pm?.suggestedScore != null ? Number(pm.suggestedScore) : 0;

  if (greenPath) {
    if (!catalogPrimaryIsUn(primary)) {
      reason_codes.push("PRIMARY_UNIT_NOT_UN");
      recommended_actions.push(
        "Unidade primária sugerida para cadastro não é UN — confirmar antes de gravar.",
      );
    }
  } else {
    if (needsConfirmation) {
      reason_codes.push("PRODUCT_MATCH_NEEDS_CONFIRMATION");
      recommended_actions.push("Validar cadastro manualmente antes de aprovar o vínculo.");
    }

    if (
      status === "UNIT_CONFLICT_PENDING" ||
      status === "UNIT_VALIDATION_REQUIRED"
    ) {
      reason_codes.push("UNIT_CONFLICT_OR_VALIDATION");
      recommended_actions.push("Conferir unidade da nota versus cadastro e conversões necessárias.");
    }

    const hasResolved =
      pm?.resolvedProductId != null && String(pm.resolvedProductId).trim() !== "";

    if (
      status === "NEW_PRODUCT_STAGED" ||
      (!hasResolved && score < thresholds.confirmMinScore)
    ) {
      reason_codes.push("NO_CLEAR_EXISTING_PRODUCT");
      recommended_actions.push("Validar se já existe produto equivalente no catálogo para evitar duplicidade.");
    }

    if (ficha.hit) {
      reason_codes.push(...ficha.reason_codes);
      recommended_actions.push("Validar se este item deve ser tratado como ficha técnica / preparo.");
    }

    const productId = match_reuse.reused_product_id;
    if (
      productId &&
      params.recipeEvidence &&
      !params.recipeEvidence.is_recipe_output &&
      !params.recipeEvidence.has_operational_recipe_link &&
      (ficha.hit || needsConfirmation)
    ) {
      reason_codes.push("NO_RECIPE_LINK_EVIDENCE");
      recommended_actions.push("Validar vínculo com receita importada ou operacional, se aplicável.");
    }

    if (!cost_suggestion.line_total_check_ok) {
      reason_codes.push("LINE_TOTAL_NUMERIC_MISMATCH");
      recommended_actions.push("Conferir quantidade × valor unitário versus total da linha na NF-e.");
    }
  }

  const manual_required = reason_codes.length > 0;

  return {
    match_reuse,
    conversion_plan: {
      preserved_primary_unit: primary,
      missing_conversions_to_create: missing,
      existing_conversions_summary,
    },
    cost_suggestion,
    manual_review: {
      required: manual_required,
      status: manual_required ? "REVIEW_REQUIRED" : "OK",
      reason_codes: [...new Set(reason_codes)],
      recommended_actions: [...new Set(recommended_actions)],
    },
    scope: "dev_preview_only",
  };
}

/** Calcula quantidade em unidade de cadastro quando não há stockQuantity do matcher. */
export function stockQuantityFallback(params: {
  invoiceQuantity: number;
  invoiceUnitRaw: string | null | undefined;
  catalogUnitRaw: string | null | undefined;
}): number | null {
  const q = Math.max(0, Number(params.invoiceQuantity ?? 0));
  const inv = params.invoiceUnitRaw
    ? normalizeUnitLabel(params.invoiceUnitRaw)
    : ("UNKN" as NormalizedUnitCode);
  const cat = params.catalogUnitRaw
    ? normalizeUnitLabel(params.catalogUnitRaw)
    : ("UNKN" as NormalizedUnitCode);
  if (inv === "UNKN" || cat === "UNKN") return q;
  if (unitsAreEqual(inv, cat)) return round6(q);
  if (!unitsAreConvertible(inv, cat)) return null;
  const f = conversionFactorToA(cat, inv);
  if (f == null || !Number.isFinite(f)) return null;
  return round6(q * f);
}

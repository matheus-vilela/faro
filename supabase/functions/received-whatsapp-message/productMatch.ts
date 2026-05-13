import type { ExtractedExpenseItem } from "../_shared/openaiExpense.ts";
import {
  applySecondarySignals,
  isFlavorOnlyCatalogInsideCompositeInvoice,
  scoreNameMatch,
} from "../_shared/productImport/matchingScore.ts";
import {
  canonicalProductName,
  normalizeInvoiceProductLabel,
  stripTrailingPackagingQtyAndUnitsForCatalogName,
} from "../_shared/productImport/canonicalName.ts";
import {
  consolidateInvoiceItems,
  pickInvoiceUnitRaw,
  type ExtractedItemWithInvoiceMeta,
} from "../_shared/productImport/consolidateItems.ts";
import {
  clampThresholds,
  DEFAULT_IMPORT_MATCH_THRESHOLDS,
  type ImportMatchThresholds,
} from "../_shared/productImport/matchConfig.ts";
import type { ImportItemResolutionStatus } from "../_shared/productImport/resolutionStatus.ts";
import {
  computeStockQuantity,
  pickProductUnitRule,
  type ProductUnitRuleRow,
  type ResolutionSource,
} from "../_shared/productImport/unitConversion.ts";
import {
  conversionFactorToA,
  normalizeUnitLabel,
  unitsAreConvertible,
  unitsAreEqual,
  type NormalizedUnitCode,
} from "../_shared/productImport/unitNormalize.ts";
import {
  assistBorderlineProductMatch,
  assistImportColdNewProduct,
} from "../_shared/productImport/productMatchLlmAssist.ts";
import {
  augmentScoredListWithVectorNeighbors,
  ensureCompanyProductNameEmbeddings,
  embeddingModelFromEnv,
} from "../_shared/productEmbedding.ts";

/** @deprecated usar limiares em matchConfig (escala 0–100). */
export const AUTO_LINK_MIN_SIMILARITY = 0.92;

export type ProductRow = {
  id: string;
  name: string;
  unit: string | null;
  barcode?: string | null;
  ncm?: string | null;
};

export type ItemWithProductMatch = ExtractedExpenseItem & {
  productId?: string | null;
  productMatch?: {
    resolvedProductId: string | null;
    suggestedProductId: string | null;
    suggestedProductName: string | null;
    /** 0–100 */
    suggestedScore: number;
    needsConfirmation: boolean;
    resolutionStatus: ImportItemResolutionStatus;
    matchReason?: string;
    invoiceUnitNormalized?: NormalizedUnitCode | string;
    catalogUnitNormalized?: NormalizedUnitCode | string;
    unitConvertible?: boolean;
    /** Quantidade na unidade do cadastro (após conversão). */
    stockQuantity?: number;
    conversionFactorApplied?: number;
    resolutionSource?: string;
    /** Rastreio para métricas: origem da decisão de vínculo. */
    decisionPath?: string;
    borderlineLlmRationale?: string;
    borderlineLlmSuggestedName?: string;
    /** Pós-match: `assistInvoiceLineUnits` (produção + preview). */
    invoice_line_units_llm?: Record<string, unknown>;
  };
};

export type ResolveProductMatchesResult = {
  items: ItemWithProductMatch[];
  requiresProductConfirmation: boolean;
  /** Quando true, importadores não devem chamar findOrCreateProduct (Phase B). */
  deferProductCreationToReconciliation: boolean;
  /** Chamadas LLM na faixa borderline nesta execução (métricas). */
  borderlineLlmCalls: number;
  /** Chamadas a `assistInvoiceLineUnits` (NF-e XML / preview full). */
  lineUnitsLlmCalls?: number;
};

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

type EquivRow = {
  source_canonical_name: string;
  source_unit_normalized: string;
  product_id: string;
  requires_confirmation: boolean;
  dest_unit_normalized?: string | null;
  conversion_factor?: number | null;
};

function envProductMatchLlmForce(): boolean {
  try {
    const v =
      typeof Deno !== "undefined"
        ? Deno.env.get("FORCE_PRODUCT_MATCH_LLM")
        : "";
    return String(v ?? "").toLowerCase() === "true" || v === "1";
  } catch {
    return false;
  }
}

/** Nome para cadastro: sem quantidade de embalagem / unidade comercial no fim (ex.: "100 UN"). */
function finalizeSuggestedCatalogName(raw: string | null | undefined): string | undefined {
  const t = String(raw ?? "").trim();
  if (!t) return undefined;
  const n = stripTrailingPackagingQtyAndUnitsForCatalogName(t).trim().slice(0, 512);
  return n.length ? n : undefined;
}

function envProductMatchLlmMaxCalls(): number {
  try {
    const raw =
      typeof Deno !== "undefined"
        ? Deno.env.get("PRODUCT_MATCH_LLM_MAX_PER_INVOCATION")
        : "";
    const n = Number.parseInt(String(raw ?? "30"), 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 30;
  } catch {
    return 30;
  }
}

async function loadImportSettings(
  supabase: SupabaseClient,
  companyId: string,
): Promise<{
  thresholds: ImportMatchThresholds;
  autoApplyGlobalMassVolume: boolean;
  llmBorderlineMatchEnabled: boolean;
  deferProductCreationToReconciliation: boolean;
}> {
  const { data, error } = await supabase
    .from("company_product_import_settings")
    .select(
      "auto_match_min_score, confirm_min_score, auto_apply_global_mass_volume, llm_borderline_match_enabled, defer_product_creation_to_reconciliation",
    )
    .eq("company_id", companyId)
    .maybeSingle();

  if (error || !data) {
    return {
      thresholds: clampThresholds(DEFAULT_IMPORT_MATCH_THRESHOLDS),
      autoApplyGlobalMassVolume: false,
      llmBorderlineMatchEnabled: envProductMatchLlmForce(),
      deferProductCreationToReconciliation: false,
    };
  }
  const d = data as {
    auto_match_min_score?: number;
    confirm_min_score?: number;
    auto_apply_global_mass_volume?: boolean;
    llm_borderline_match_enabled?: boolean;
    defer_product_creation_to_reconciliation?: boolean;
  };
  return {
    thresholds: clampThresholds({
      autoMatchMinScore: d.auto_match_min_score,
      confirmMinScore: d.confirm_min_score,
    }),
    autoApplyGlobalMassVolume: !!d.auto_apply_global_mass_volume,
    llmBorderlineMatchEnabled:
      envProductMatchLlmForce() || !!d.llm_borderline_match_enabled,
    deferProductCreationToReconciliation:
      !!d.defer_product_creation_to_reconciliation,
  };
}

const RESOLUTION_SOURCE_PT: Record<ResolutionSource, string> = {
  DIRECT_UNIT_MATCH: "mesma unidade (sem conversão)",
  AUTO_CONVERTED_GLOBAL_RULE: "conversão global massa/volume",
  AUTO_CONVERTED_PRODUCT_RULE: "regra de conversão do produto",
  UNIT_VALIDATION_REQUIRED: "validação de unidade necessária",
  UNKNOWN_INVOICE_UNIT: "unidade da nota ausente ou não reconhecida",
};

function equivToProductRule(
  e: EquivRow,
  invoiceU: NormalizedUnitCode,
  catalogU: NormalizedUnitCode,
): ProductUnitRuleRow | null {
  if (e.conversion_factor == null || e.dest_unit_normalized == null) {
    return null;
  }
  const dest = normalizeUnitLabel(e.dest_unit_normalized);
  if (dest !== catalogU) return null;
  return {
    from_unit_normalized: invoiceU,
    to_unit_normalized: catalogU,
    conversion_factor: Number(e.conversion_factor),
    auto_apply: !e.requires_confirmation,
    requires_confirmation: e.requires_confirmation,
  };
}

function enrichProductMatch(
  it: ExtractedExpenseItem,
  partial: NonNullable<ItemWithProductMatch["productMatch"]>,
  product: ProductRow,
  invoiceU: NormalizedUnitCode,
  autoGlobal: boolean,
  rules: ProductUnitRuleRow[],
  equivRule: ProductUnitRuleRow | null,
): NonNullable<ItemWithProductMatch["productMatch"]> {
  const catU = normalizeUnitLabel(product.unit);
  const rule = equivRule ?? pickProductUnitRule(rules, invoiceU, catU);
  /** Novo produto com nome já sugerido: não comparar unidade com o «melhor» candidato do catálogo (evita falso conflito). */
  const stagingNewWithSuggestedName =
    (!partial.resolvedProductId ||
      String(partial.resolvedProductId).trim() === "") &&
    String(partial.borderlineLlmSuggestedName ?? "").trim() !== "";
  let c = computeStockQuantity({
    invoiceQuantity: Number(it.quantity),
    invoiceUnit: invoiceU,
    productUnitRaw: product.unit,
    autoApplyGlobalMassVolume: autoGlobal,
    productRule: rule,
  });
  if (stagingNewWithSuggestedName) {
    const q = Math.max(0.0001, Number(it.quantity));
    c = {
      stockQuantity: q,
      conversionFactorApplied: 1,
      resolutionSource: "DIRECT_UNIT_MATCH",
      needsUserConfirmation: false,
    };
  }
  let resolved = partial.resolvedProductId;
  let needs = partial.needsConfirmation;
  let st = partial.resolutionStatus;
  if (c.needsUserConfirmation && resolved) {
    resolved = null;
    needs = true;
    st = "UNIT_VALIDATION_REQUIRED";
  }
  if (c.needsUserConfirmation) {
    needs = true;
  }
  return {
    ...partial,
    resolvedProductId: resolved,
    needsConfirmation: needs,
    resolutionStatus: st,
    stockQuantity: c.stockQuantity,
    conversionFactorApplied: c.conversionFactorApplied,
    resolutionSource: c.resolutionSource,
    invoiceUnitNormalized: invoiceU,
    catalogUnitNormalized: catU,
    matchReason: partial.matchReason
      ? `${partial.matchReason} · estoque: ${c.stockQuantity} (${RESOLUTION_SOURCE_PT[c.resolutionSource] ?? c.resolutionSource})`
      : `estoque: ${c.stockQuantity} (${RESOLUTION_SOURCE_PT[c.resolutionSource] ?? c.resolutionSource})`,
  };
}

function decideWithUnits(params: {
  thresholds: ImportMatchThresholds;
  bestScore: number;
  invoiceU: NormalizedUnitCode;
  catalogU: NormalizedUnitCode;
  hasCandidate: boolean;
}): {
  resolutionStatus: ImportItemResolutionStatus;
  needsConfirmation: boolean;
  unitConvertible: boolean;
  matchReason: string;
} {
  const { thresholds, bestScore, invoiceU, catalogU, hasCandidate } = params;
  const auto = thresholds.autoMatchMinScore;
  const conf = thresholds.confirmMinScore;

  if (!hasCandidate) {
    return {
      resolutionStatus: "NEW_PRODUCT_STAGED",
      needsConfirmation: true,
      unitConvertible: false,
      matchReason: "Nenhum produto candidato no catálogo",
    };
  }

  const same = unitsAreEqual(invoiceU, catalogU);
  const conv =
    unitsAreConvertible(invoiceU, catalogU) && !same;

  if (bestScore >= auto && same) {
    return {
      resolutionStatus: "AUTO_MATCH",
      needsConfirmation: false,
      unitConvertible: false,
      matchReason: `Pontuação ${bestScore.toFixed(1)} ≥ ${auto} e unidade compatível (${invoiceU})`,
    };
  }

  if (bestScore >= auto && invoiceU === "UNKN") {
    return {
      resolutionStatus: "AUTO_MATCH",
      needsConfirmation: false,
      unitConvertible: false,
      matchReason:
        `Pontuação ${bestScore.toFixed(1)} ≥ ${auto}; unidade da nota ausente — vínculo por nome forte (cadastro ${catalogU})`,
    };
  }

  if (bestScore >= auto && !same && conv) {
    return {
      resolutionStatus: "UNIT_CONFLICT_PENDING",
      needsConfirmation: true,
      unitConvertible: true,
      matchReason:
        `Pontuação ${bestScore.toFixed(1)} ≥ ${auto}, mas a unidade da nota (${invoiceU}) difere do cadastro (${catalogU}); conversão não automática`,
    };
  }

  if (bestScore >= auto && !same && !conv) {
    return {
      resolutionStatus: "UNIT_CONFLICT_PENDING",
      needsConfirmation: true,
      unitConvertible: false,
      matchReason:
        `Pontuação ${bestScore.toFixed(1)} ≥ ${auto}, mas as unidades ${invoiceU} (nota) e ${catalogU} (cadastro) exigem confirmação`,
    };
  }

  if (bestScore >= conf) {
    return {
      resolutionStatus: "PENDING_USER_CONFIRM",
      needsConfirmation: true,
      unitConvertible: conv,
      matchReason:
        `Pontuação ${bestScore.toFixed(1)} entre ${conf} e ${auto - 1}; confirmação recomendada`,
    };
  }

  return {
    resolutionStatus: "NEW_PRODUCT_STAGED",
    needsConfirmation: true,
    unitConvertible: false,
    matchReason: `Pontuação ${bestScore.toFixed(1)} < ${conf}; tratar como novo produto`,
  };
}

export type ResolveProductMatchesOptions = {
  /**
   * Import XML/ZIP em lote: não adia criação de produto à reconciliação;
   * usa IA também fora da faixa borderline (scores baixos) com mais candidatos.
   */
  importBatch?: boolean;
  /**
   * Evita backfill de embeddings durante processamento de lote.
   * Útil para reduzir latência em workers de importação.
   */
  skipEmbeddingBackfill?: boolean;
  /**
   * Desliga assistências com OpenAI (vector + borderline LLM) para priorizar robustez.
   */
  skipLlmAssist?: boolean;
};

export async function resolveProductMatches(
  supabase: SupabaseClient,
  companyId: string,
  items: ExtractedExpenseItem[],
  opts?: ResolveProductMatchesOptions,
): Promise<ResolveProductMatchesResult> {
  let {
    thresholds,
    autoApplyGlobalMassVolume,
    llmBorderlineMatchEnabled,
    deferProductCreationToReconciliation,
  } = await loadImportSettings(supabase, companyId);
  if (opts?.importBatch) {
    deferProductCreationToReconciliation = false;
  }

  let borderlineLlmRemaining = envProductMatchLlmMaxCalls();
  let borderlineLlmCalls = 0;

  let openaiKey = "";
  let openaiModel = "gpt-4o-mini";
  try {
    if (typeof Deno !== "undefined") {
      openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
      openaiModel =
        Deno.env.get("OPENAI_PRODUCT_MATCH_MODEL") ?? "gpt-4o-mini";
    }
  } catch {
    openaiKey = "";
  }

  const embeddingModel = embeddingModelFromEnv();

  const itemsSanitized = (items ?? []).filter(
    (x): x is ExtractedExpenseItem =>
      x != null && typeof x === "object",
  );
  const merged = consolidateInvoiceItems(
    itemsSanitized as ExtractedItemWithInvoiceMeta[],
  ) as ExtractedExpenseItem[];

  const { data: aliasRows, error: aliasErr } = await supabase
    .from("product_invoice_line_aliases")
    .select("normalized_label, product_id")
    .eq("company_id", companyId);

  if (aliasErr) {
    console.error("[productMatch] aliases:", aliasErr.message);
  }

  const aliasMap = new Map<string, string>();
  for (const row of (aliasRows ?? []) as Array<{
    normalized_label: string;
    product_id: string;
  }>) {
    aliasMap.set(row.normalized_label, row.product_id);
  }

  const { data: equivRows, error: equivErr } = await supabase
    .from("product_import_equivalences")
    .select(
      "source_canonical_name, source_unit_normalized, product_id, requires_confirmation, dest_unit_normalized, conversion_factor",
    )
    .eq("company_id", companyId);

  if (equivErr) {
    console.error("[productMatch] equivalences:", equivErr.message);
  }

  const equivList = (equivRows ?? []) as EquivRow[];

  const { data: ruleRowsData, error: rulesErr } = await supabase
    .from("product_unit_rules")
    .select(
      "product_id, from_unit_normalized, to_unit_normalized, conversion_factor, auto_apply, requires_confirmation",
    )
    .eq("company_id", companyId);

  if (rulesErr) {
    console.error("[productMatch] product_unit_rules:", rulesErr.message);
  }

  const rulesByProduct = new Map<string, ProductUnitRuleRow[]>();
  for (const raw of (ruleRowsData ?? []) as Array<{
    product_id: string;
    from_unit_normalized: string;
    to_unit_normalized: string;
    conversion_factor: number;
    auto_apply: boolean;
    requires_confirmation: boolean;
  }>) {
    const row: ProductUnitRuleRow = {
      from_unit_normalized: raw.from_unit_normalized,
      to_unit_normalized: raw.to_unit_normalized,
      conversion_factor: Number(raw.conversion_factor),
      auto_apply: raw.auto_apply,
      requires_confirmation: raw.requires_confirmation,
    };
    const list = rulesByProduct.get(raw.product_id) ?? [];
    list.push(row);
    rulesByProduct.set(raw.product_id, list);
  }

  const { data: prodRows, error: prodErr } = await supabase
    .from("products")
    .select("id, name, unit, barcode, ncm")
    .eq("company_id", companyId)
    .eq("is_active", true);

  if (prodErr) {
    console.error("[productMatch] products:", prodErr.message);
  }

  const products = (prodRows ?? []) as ProductRow[];
  const productById = new Map(products.map((p) => [p.id, p]));

  if (
    opts?.importBatch &&
    !opts?.skipEmbeddingBackfill &&
    openaiKey &&
    products.length > 0
  ) {
    try {
      const { updated, errors } = await ensureCompanyProductNameEmbeddings(
        supabase,
        companyId,
        openaiKey,
        embeddingModel,
      );
      if (updated > 0 || errors > 0) {
        console.log(
          "[productMatch] name_embedding backfill",
          JSON.stringify({ company_id: companyId, updated, errors }),
        );
      }
    } catch (e) {
      console.error("[productMatch] name_embedding backfill:", e);
    }
  }

  const out: ItemWithProductMatch[] = [];
  let requiresProductConfirmation = false;

  for (const it of merged) {
    const name = (it.productName ?? "").trim() || "Item";
    const nl = normalizeInvoiceProductLabel(name);
    const invCanon = canonicalProductName(name);
    const rawUnit = pickInvoiceUnitRaw(it as ExtractedItemWithInvoiceMeta);
    const invoiceU = rawUnit ? normalizeUnitLabel(rawUnit) : "UNKN";

    const itemNcm = (it as ExtractedExpenseItem & { ncm?: string | null }).ncm;
    const itemEan = (it as ExtractedExpenseItem & { ean?: string | null }).ean;

    const equiv = equivList.find(
      (e) =>
        e.source_canonical_name === invCanon &&
        e.source_unit_normalized === invoiceU,
    );

    if (equiv) {
      const p = productById.get(equiv.product_id);
      if (p) {
        const catU = normalizeUnitLabel(p.unit);
        const eqRule = equivToProductRule(equiv, invoiceU, catU);
        const prules = rulesByProduct.get(p.id) ?? [];
        if (equiv.requires_confirmation) {
          requiresProductConfirmation = true;
          const mPend = enrichProductMatch(
            it,
            {
              resolvedProductId: null,
              suggestedProductId: p.id,
              suggestedProductName: p.name,
              suggestedScore: 100,
              needsConfirmation: true,
              resolutionStatus: "PENDING_USER_CONFIRM",
              matchReason: "Equivalência cadastrada — confirmação obrigatória",
              invoiceUnitNormalized: invoiceU,
              catalogUnitNormalized: catU,
              unitConvertible: unitsAreConvertible(invoiceU, catU) &&
                !unitsAreEqual(invoiceU, catU),
            },
            p,
            invoiceU,
            autoApplyGlobalMassVolume,
            prules,
            eqRule,
          );
          out.push({
            ...it,
            productId: mPend.resolvedProductId,
            productMatch: mPend,
          });
          continue;
        }
        const mOk = enrichProductMatch(
          it,
          {
            resolvedProductId: p.id,
            suggestedProductId: p.id,
            suggestedProductName: p.name,
            suggestedScore: 100,
            needsConfirmation: false,
            resolutionStatus: "AUTO_MATCH",
            matchReason: "Equivalência manual aprovada (nome canônico + unidade)",
            invoiceUnitNormalized: invoiceU,
            catalogUnitNormalized: catU,
            unitConvertible: false,
          },
          p,
          invoiceU,
          autoApplyGlobalMassVolume,
          prules,
          eqRule,
        );
        if (mOk.needsConfirmation) requiresProductConfirmation = true;
        out.push({
          ...it,
          productId: mOk.resolvedProductId,
          productMatch: mOk,
        });
        continue;
      }
    }

    const aliasPid = nl ? aliasMap.get(nl) : undefined;
    if (aliasPid) {
      const p = productById.get(aliasPid);
      if (p) {
        const catU = normalizeUnitLabel(p.unit);
        const prulesA = rulesByProduct.get(p.id) ?? [];
        if (unitsAreEqual(invoiceU, catU) || invoiceU === "UNKN") {
          const mAlias = enrichProductMatch(
            it,
            {
              resolvedProductId: p.id,
              suggestedProductId: p.id,
              suggestedProductName: p.name,
              suggestedScore: 100,
              needsConfirmation: false,
              resolutionStatus: "AUTO_MATCH",
              matchReason: "Alias de linha de nota (rótulo normalizado)",
              invoiceUnitNormalized: invoiceU,
              catalogUnitNormalized: catU,
              unitConvertible: false,
            },
            p,
            invoiceU,
            autoApplyGlobalMassVolume,
            prulesA,
            null,
          );
          if (mAlias.needsConfirmation) requiresProductConfirmation = true;
          out.push({
            ...it,
            productId: mAlias.resolvedProductId,
            productMatch: mAlias,
          });
          continue;
        }
        const decision = decideWithUnits({
          thresholds,
          bestScore: 96,
          invoiceU,
          catalogU: catU,
          hasCandidate: true,
        });
        requiresProductConfirmation = true;
        const mAlias2 = enrichProductMatch(
          it,
          {
            resolvedProductId: null,
            suggestedProductId: p.id,
            suggestedProductName: p.name,
            suggestedScore: 96,
            needsConfirmation: true,
            resolutionStatus: decision.resolutionStatus,
            matchReason:
              "Alias encontrado; " + (decision.matchReason ?? ""),
            invoiceUnitNormalized: invoiceU,
            catalogUnitNormalized: catU,
            unitConvertible: decision.unitConvertible,
          },
          p,
          invoiceU,
          autoApplyGlobalMassVolume,
          prulesA,
          null,
        );
        out.push({
          ...it,
          productId: mAlias2.resolvedProductId,
          productMatch: mAlias2,
        });
        continue;
      }
    }

    const normInvoice = normalizeInvoiceProductLabel(name);
    const exactNameHits = products.filter(
      (p) => normalizeInvoiceProductLabel(p.name) === normInvoice,
    );
    if (exactNameHits.length > 0) {
      let pPick: ProductRow;
      if (exactNameHits.length === 1) {
        pPick = exactNameHits[0]!;
      } else {
        const unitOk = exactNameHits.find((p) =>
          unitsAreEqual(invoiceU, normalizeUnitLabel(p.unit)),
        );
        pPick = unitOk ?? exactNameHits[0]!;
      }
      const catUe = normalizeUnitLabel(pPick.unit);
      const prulesE = rulesByProduct.get(pPick.id) ?? [];
      const mExact = enrichProductMatch(
        it,
        {
          resolvedProductId: pPick.id,
          suggestedProductId: pPick.id,
          suggestedProductName: pPick.name,
          suggestedScore: 100,
          needsConfirmation: false,
          resolutionStatus: "AUTO_MATCH",
          matchReason: "Nome normalizado idêntico ao cadastro",
          invoiceUnitNormalized: invoiceU,
          catalogUnitNormalized: catUe,
          unitConvertible: false,
          decisionPath: "exact_normalized_name",
        },
        pPick,
        invoiceU,
        autoApplyGlobalMassVolume,
        prulesE,
        null,
      );
      if (mExact.needsConfirmation) requiresProductConfirmation = true;
      out.push({
        ...it,
        productId: mExact.resolvedProductId,
        productMatch: mExact,
      });
      continue;
    }

    type Scored = { product: ProductRow; score: number; detail: string };
    const scoredList: Scored[] = [];

    for (const p of products) {
      let sc = scoreNameMatch(name, p.name);
      const sec = applySecondarySignals({
        baseScore: sc,
        invoiceNcm: itemNcm,
        invoiceEan: itemEan,
        productNcm: p.ncm,
        productBarcode: p.barcode,
      });
      sc = sec.score;
      const reasons = Array.isArray(sec.reasons) ? sec.reasons : [];
      const extra = reasons.length ? `; ${reasons.join("; ")}` : "";
      scoredList.push({
        product: p,
        score: sc,
        detail: `pontuação ${sc.toFixed(1)}${extra}`,
      });
    }

    scoredList.sort((a, b) => b.score - a.score);

    if (
      opts?.importBatch &&
      !opts?.skipLlmAssist &&
      openaiKey &&
      products.length > 0 &&
      name.trim()
    ) {
      try {
        await augmentScoredListWithVectorNeighbors({
          supabase,
          companyId,
          invoiceLineName: name,
          scoredList,
          productById,
          openaiKey,
          model: embeddingModel,
        });
      } catch (e) {
        console.error("[productMatch] vector RAG:", e);
      }
    }

    if (!scoredList.length) {
      const autoNewEmpty = opts?.importBatch === true;
      if (!autoNewEmpty) requiresProductConfirmation = true;
      out.push({
        ...it,
        productId: null,
        productMatch: {
          resolvedProductId: null,
          suggestedProductId: null,
          suggestedProductName: null,
          suggestedScore: 0,
          needsConfirmation: !autoNewEmpty,
          resolutionStatus: "NEW_PRODUCT_STAGED",
          matchReason: autoNewEmpty
            ? "Catálogo vazio — cadastro automático com nome da nota."
            : "Catálogo vazio ou sem candidato",
          invoiceUnitNormalized: invoiceU,
          catalogUnitNormalized: "UNKN",
          unitConvertible: false,
          decisionPath: "catalog_empty_or_no_candidates",
          borderlineLlmSuggestedName: autoNewEmpty
            ? finalizeSuggestedCatalogName(name.trim())
            : undefined,
        },
      });
      continue;
    }

    let bestScore = scoredList[0].score;
    let bestProduct = scoredList[0].product;
    let matchReason = `Melhor candidato: ${scoredList[0].detail}`;

    const autoTh = thresholds.autoMatchMinScore;
    const confMin = thresholds.confirmMinScore;

    const topK = opts?.importBatch ? 12 : 5;
    const LLM_LINK_MIN_SCORE = 52;
    const LLM_LINK_MIN_NAME_SCORE = 42;
    const safeForLink = (s: Scored) => {
      const nameOnly = scoreNameMatch(name, s.product.name);
      return (
        s.score >= LLM_LINK_MIN_SCORE &&
        nameOnly >= LLM_LINK_MIN_NAME_SCORE &&
        !isFlavorOnlyCatalogInsideCompositeInvoice(name, s.product.name)
      );
    };
    const linkCandidates = scoredList.filter(safeForLink).slice(0, topK);

    const importBatchNoSafeLink =
      opts?.importBatch === true &&
      bestScore < autoTh &&
      linkCandidates.length === 0;

    let catU = normalizeUnitLabel(bestProduct.unit);
    let decision = decideWithUnits({
      thresholds,
      bestScore,
      invoiceU,
      catalogU: catU,
      hasCandidate: true,
    });

    let decisionPath = "scored_catalog";
    let borderlineLlmRationale: string | undefined;
    let borderlineLlmSuggestedName: string | undefined;

    const inBorderlineScoreBand = bestScore >= confMin && bestScore < autoTh;
    const importBatchLlmEligible =
      opts?.importBatch === true &&
      bestScore < autoTh &&
      !!openaiKey &&
      borderlineLlmRemaining > 0;

    const runBorderlineLlm =
      inBorderlineScoreBand &&
      llmBorderlineMatchEnabled &&
      !!openaiKey &&
      borderlineLlmRemaining > 0;

    const useColdNewOnly =
      importBatchLlmEligible && linkCandidates.length === 0;
    const useBorderlineAssist =
      linkCandidates.length > 0 &&
      (importBatchLlmEligible || runBorderlineLlm);

    const canInvokeLlm =
      !opts?.skipLlmAssist &&
      !!openaiKey &&
      borderlineLlmRemaining > 0 &&
      (useColdNewOnly || useBorderlineAssist);

    if (canInvokeLlm) {
      let assist: Awaited<ReturnType<typeof assistBorderlineProductMatch>>;
      if (useColdNewOnly) {
        borderlineLlmRemaining -= 1;
        borderlineLlmCalls += 1;
        assist = await assistImportColdNewProduct(openaiKey, openaiModel, {
          invoice_description: name,
          invoice_unit_raw: rawUnit ?? null,
          invoice_ean: itemEan ? String(itemEan) : null,
        });
      } else if (useBorderlineAssist) {
        borderlineLlmRemaining -= 1;
        borderlineLlmCalls += 1;
        const candidates = linkCandidates.map((s) => ({
          product_id: s.product.id,
          product_name: s.product.name,
          catalog_unit: s.product.unit ?? null,
          similarity_score_0_100: Math.round(s.score * 10) / 10,
        }));
        assist = await assistBorderlineProductMatch(openaiKey, openaiModel, {
          invoice_description: name,
          invoice_unit_raw: rawUnit ?? null,
          invoice_ean: itemEan ? String(itemEan) : null,
          candidates,
          mode: opts?.importBatch ? "import_xml_batch" : "borderline",
        });
      } else {
        assist = { kind: "SKIP", rationale: "Sem candidatos seguros para IA." };
      }

      if (assist.kind === "LINK") {
        const picked = productById.get(assist.product_id);
        if (picked) {
          const pickedEntry = scoredList.find((s) => s.product.id === picked.id);
          bestProduct = picked;
          if (pickedEntry) {
            bestScore = pickedEntry.score;
            matchReason = `Melhor candidato: ${pickedEntry.detail}`;
          }
          catU = normalizeUnitLabel(bestProduct.unit);
          decision = decideWithUnits({
            thresholds,
            bestScore,
            invoiceU,
            catalogU: catU,
            hasCandidate: true,
          });
          decisionPath = "borderline_llm_link";
          borderlineLlmRationale = assist.rationale;
        }
      } else if (assist.kind === "NEW_PRODUCT") {
        decisionPath = useColdNewOnly
          ? "import_llm_cold_new"
          : "borderline_llm_new_hint";
        borderlineLlmRationale = assist.rationale;
        borderlineLlmSuggestedName = finalizeSuggestedCatalogName(
          assist.suggested_catalog_name,
        );
      } else if (assist.kind === "SKIP") {
        decisionPath = "borderline_llm_skip";
        borderlineLlmRationale = assist.rationale;
        if (useColdNewOnly && opts?.importBatch) {
          borderlineLlmSuggestedName = finalizeSuggestedCatalogName(name.trim());
          decisionPath = "import_llm_cold_fallback";
          borderlineLlmRationale = `${assist.rationale} · fallback: nome da nota.`;
        } else if (
          opts?.importBatch &&
          bestScore < autoTh &&
          useBorderlineAssist
        ) {
          borderlineLlmSuggestedName = finalizeSuggestedCatalogName(name.trim());
          decisionPath = "import_batch_borderline_llm_skip_auto_new";
          borderlineLlmRationale = `${assist.rationale} · cadastro automático (batch) com nome da nota.`;
        }
      } else if (assist.kind === "ERROR") {
        decisionPath = "borderline_llm_error";
        borderlineLlmRationale = assist.message;
        if (useColdNewOnly && opts?.importBatch) {
          borderlineLlmSuggestedName = finalizeSuggestedCatalogName(name.trim());
          decisionPath = "import_llm_cold_fallback_error";
          borderlineLlmRationale = `${assist.message} · fallback: nome da nota.`;
        } else if (opts?.importBatch && bestScore < autoTh && useBorderlineAssist) {
          borderlineLlmSuggestedName = finalizeSuggestedCatalogName(name.trim());
          decisionPath = "import_batch_borderline_llm_error_auto_new";
          borderlineLlmRationale = `${assist.message} · cadastro automático (batch) com nome da nota.`;
        }
      }
    } else if (importBatchNoSafeLink) {
      borderlineLlmSuggestedName = finalizeSuggestedCatalogName(name.trim());
      decisionPath = "import_batch_deterministic_new";
      borderlineLlmRationale =
        "Sem candidatos com similaridade mínima no catálogo; cadastro automático com o nome da nota.";
    } else if (inBorderlineScoreBand && !canInvokeLlm) {
      decisionPath = "scored_borderline_no_llm";
    } else if (
      opts?.importBatch &&
      bestScore < autoTh &&
      linkCandidates.length > 0 &&
      !openaiKey
    ) {
      decisionPath = "import_batch_no_openai_key";
      borderlineLlmSuggestedName = finalizeSuggestedCatalogName(name.trim());
      borderlineLlmRationale =
        "Sem OpenAI no servidor; cadastro automático (batch) com nome da nota.";
    }

    let resolvedId: string | null = null;
    if (
      decision.resolutionStatus === "AUTO_MATCH" &&
      !decision.needsConfirmation
    ) {
      resolvedId = bestProduct.id;
    }

    let needsConfirmation = decision.needsConfirmation || resolvedId == null;

    if (
      opts?.importBatch === true &&
      String(borderlineLlmSuggestedName ?? "").trim() !== ""
    ) {
      const blockOnlyUnitOrAmbiguousMatch =
        decision.resolutionStatus === "UNIT_CONFLICT_PENDING" ||
        decision.resolutionStatus === "UNIT_VALIDATION_REQUIRED" ||
        decision.resolutionStatus === "PENDING_USER_CONFIRM";
      if (!blockOnlyUnitOrAmbiguousMatch) {
        needsConfirmation = false;
      }
    }

    if (needsConfirmation) {
      requiresProductConfirmation = true;
    }

    const suggestedIdOut =
      bestScore >= confMin ? bestProduct.id : null;
    const suggestedNameOut =
      bestScore >= confMin ? bestProduct.name : null;

    let matchReasonFinal =
      decision.matchReason + (matchReason ? ` (${matchReason})` : "");
    if (borderlineLlmRationale) {
      matchReasonFinal += ` · IA: ${borderlineLlmRationale}`;
    }
    if (borderlineLlmSuggestedName) {
      matchReasonFinal += ` · Sugestão de nome (IA): ${borderlineLlmSuggestedName}`;
    }

    const prulesB = rulesByProduct.get(bestProduct.id) ?? [];
    const mBest = enrichProductMatch(
      it,
      {
        resolvedProductId: resolvedId,
        suggestedProductId: suggestedIdOut,
        suggestedProductName: suggestedNameOut,
        suggestedScore: Math.round(bestScore * 10) / 10,
        needsConfirmation,
        resolutionStatus: decision.resolutionStatus,
        matchReason: matchReasonFinal,
        invoiceUnitNormalized: invoiceU,
        catalogUnitNormalized: catU,
        unitConvertible: decision.unitConvertible,
        decisionPath,
        borderlineLlmRationale,
        borderlineLlmSuggestedName,
      },
      bestProduct,
      invoiceU,
      autoApplyGlobalMassVolume,
      prulesB,
      null,
    );
    if (mBest.needsConfirmation) requiresProductConfirmation = true;
    out.push({
      ...it,
      productId: mBest.resolvedProductId,
      productMatch: mBest,
    });
  }

  return {
    items: out,
    requiresProductConfirmation,
    deferProductCreationToReconciliation,
    borderlineLlmCalls,
    lineUnitsLlmCalls: 0,
  };
}

export async function upsertProductInvoiceAlias(
  supabase: SupabaseClient,
  companyId: string,
  invoiceLineProductName: string,
  productId: string,
): Promise<void> {
  const nl = normalizeInvoiceProductLabel(invoiceLineProductName);
  if (!nl) return;
  const { error } = await supabase.from("product_invoice_line_aliases").upsert(
    {
      company_id: companyId,
      normalized_label: nl,
      product_id: productId,
    },
    { onConflict: "company_id,normalized_label" },
  );
  if (error) {
    console.error("[productMatch] upsert alias:", error.message);
  }
}

export function conversionHint(
  catalogUnit: NormalizedUnitCode,
  invoiceUnit: NormalizedUnitCode,
): number | null {
  return conversionFactorToA(catalogUnit, invoiceUnit);
}

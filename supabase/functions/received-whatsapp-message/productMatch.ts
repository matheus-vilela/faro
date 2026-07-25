import type { ExtractedExpenseItem } from "../_shared/openaiExpense.ts";
import {
  canonicalProductName,
  normalizeInvoiceProductLabel,
  sanitizeCatalogProductName,
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
import { eanLookupKeys } from "../_shared/productImport/llmCatalogCandidates.ts";
import {
  matchImportBatchLineWithCatalog,
  type ImportBatchCatalogMatchResult,
} from "../_shared/productImport/importBatchCatalogMatch.ts";
import {
  loadSupplierProductMatchHints,
  matchExistingProductFromNfeXmlLine,
} from "../_shared/productImport/matchExistingProductFromNfeXml.ts";
import {
  normalizeCProd,
  upsertProductSupplierCode,
} from "../_shared/productImport/productSupplierCodes.ts";

/** @deprecated usar limiares em matchConfig (escala 0–100). */
export const AUTO_LINK_MIN_SIMILARITY = 0.92;

export type ProductRow = {
  id: string;
  name: string;
  unit: string | null;
  barcode?: string | null;
  ean?: string | null;
  ncm?: string | null;
  sku?: string | null;
  canonical_name?: string | null;
  merged_catalog_names?: string[] | null;
  is_active?: boolean | null;
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
    /** @deprecated unidades por IA removidas do fluxo. */
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
  /** Sempre 0 — assist de unidades por IA removido. */
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

/** Nome para cadastro: sem lixo de NF (asteriscos, packs, peso no fim). */
function finalizeSuggestedCatalogName(raw: string | null | undefined): string | undefined {
  const t = String(raw ?? "").trim();
  if (!t) return undefined;
  const n = sanitizeCatalogProductName(t).slice(0, 512);
  return n.length ? n : undefined;
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

function buildImportBatchMatchOutput(params: {
  it: ExtractedExpenseItem;
  name: string;
  invoiceU: NormalizedUnitCode;
  batchResult: ImportBatchCatalogMatchResult;
  products: ProductRow[];
  thresholds: ImportMatchThresholds;
  autoApplyGlobalMassVolume: boolean;
  rulesByProduct: Map<string, ProductUnitRuleRow[]>;
  rawUnit: string | null;
}): ItemWithProductMatch {
  const {
    it,
    invoiceU,
    batchResult,
    autoApplyGlobalMassVolume,
    rulesByProduct,
    rawUnit,
  } = params;

  const linkProduct =
    batchResult.kind === "DIRECT_EAN" ||
    batchResult.kind === "DIRECT_CPROD_SUPPLIER" ||
    batchResult.kind === "DIRECT_XML_IDENTITY"
      ? batchResult.product
      : null;

  if (linkProduct) {
    const prules = rulesByProduct.get(linkProduct.id) ?? [];
    const criterio =
      batchResult.kind === "NEW_PRODUCT" ? null : batchResult.criterio;
    const matchReason =
      batchResult.kind === "DIRECT_EAN"
        ? "EAN igual ao cadastro"
        : batchResult.kind === "DIRECT_CPROD_SUPPLIER"
          ? "cProd + fornecedor iguais ao cadastro"
          : `Identificadores do XML (${criterio ?? "xml"}) iguais ao cadastro`;
    const decisionPath =
      batchResult.kind === "DIRECT_EAN"
        ? "import_batch_direct_ean"
        : batchResult.kind === "DIRECT_CPROD_SUPPLIER"
          ? "import_batch_direct_cprod_supplier"
          : "import_batch_direct_xml_identity";
    const partial: NonNullable<ItemWithProductMatch["productMatch"]> = {
      resolvedProductId: linkProduct.id,
      suggestedProductId: linkProduct.id,
      suggestedProductName: linkProduct.name,
      suggestedScore: 100,
      needsConfirmation: false,
      resolutionStatus: "AUTO_MATCH",
      matchReason,
      invoiceUnitNormalized: invoiceU,
      catalogUnitNormalized: normalizeUnitLabel(linkProduct.unit),
      unitConvertible: false,
      decisionPath,
    };
    const m = enrichProductMatch(
      it,
      partial,
      linkProduct,
      invoiceU,
      autoApplyGlobalMassVolume,
      prules,
      null,
    );
    return { ...it, productId: m.resolvedProductId, productMatch: m };
  }

  const suggestedRaw = batchResult.kind === "NEW_PRODUCT"
    ? batchResult.fallbackSuggestedName
    : finalizeSuggestedCatalogName(params.name.trim()) ?? params.name.trim();
  const suggestedName = finalizeSuggestedCatalogName(suggestedRaw) ?? suggestedRaw;
  const rationale = batchResult.kind === "NEW_PRODUCT"
    ? batchResult.rationale
    : "Sem identificador determinístico — cadastro automático.";

  const stubProduct: ProductRow = {
    id: "",
    name: suggestedName,
    unit: rawUnit ?? null,
  };
  const partial: NonNullable<ItemWithProductMatch["productMatch"]> = {
    resolvedProductId: null,
    suggestedProductId: null,
    suggestedProductName: null,
    suggestedScore: 0,
    needsConfirmation: false,
    resolutionStatus: "NEW_PRODUCT_STAGED",
    matchReason: rationale,
    invoiceUnitNormalized: invoiceU,
    catalogUnitNormalized: normalizeUnitLabel(stubProduct.unit),
    unitConvertible: false,
    decisionPath: "import_batch_deterministic_new",
    borderlineLlmSuggestedName: suggestedName,
  };
  const m = enrichProductMatch(
    it,
    partial,
    stubProduct,
    invoiceU,
    autoApplyGlobalMassVolume,
    [],
    null,
  );
  return { ...it, productId: null, productMatch: m };
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
   * sem match por IA — EAN / cProd+fornecedor ou produto novo.
   */
  importBatch?: boolean;
  /**
   * @deprecated Sempre ignorado — embeddings de match removidos.
   */
  skipEmbeddingBackfill?: boolean;
  /**
   * @deprecated Sempre ignorado — vínculo por IA removido.
   */
  skipLlmAssist?: boolean;
  /** Fornecedor da NF (para match/upsert de cProd). */
  supplierId?: string | null;
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
    deferProductCreationToReconciliation,
  } = await loadImportSettings(supabase, companyId);
  if (opts?.importBatch) {
    deferProductCreationToReconciliation = false;
  }

  const supplierId =
    opts?.supplierId != null ? String(opts.supplierId).trim() || null : null;

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
    .select(
      "id, name, unit, barcode, ean, ncm, sku, canonical_name, merged_catalog_names",
    )
    .eq("company_id", companyId)
    .eq("is_active", true);

  if (prodErr) {
    console.error("[productMatch] products:", prodErr.message);
  }

  const products = (prodRows ?? []) as ProductRow[];
  const productById = new Map(products.map((p) => [p.id, p]));
  const supplierHints = await loadSupplierProductMatchHints(
    supabase,
    companyId,
    supplierId,
  );

  const out: ItemWithProductMatch[] = [];
  let requiresProductConfirmation = false;

  for (const it of merged) {
    const name = (it.productName ?? "").trim() || "Item";
    const nl = normalizeInvoiceProductLabel(name);
    const invCanon = canonicalProductName(name);
    const rawUnit = pickInvoiceUnitRaw(it as ExtractedItemWithInvoiceMeta);
    const invoiceU = rawUnit ? normalizeUnitLabel(rawUnit) : "UNKN";

    const itemEan = (it as ExtractedExpenseItem & { ean?: string | null }).ean;
    const cProd = normalizeCProd(it.productCode);

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
        if (mOk.resolvedProductId) {
          await upsertProductSupplierCode(
            supabase,
            companyId,
            supplierId,
            cProd,
            mOk.resolvedProductId,
          );
        }
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
          if (mAlias.resolvedProductId) {
            await upsertProductSupplierCode(
              supabase,
              companyId,
              supplierId,
              cProd,
              mAlias.resolvedProductId,
            );
          }
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

    if (opts?.importBatch === true) {
      const batchResult = await matchImportBatchLineWithCatalog({
        item: it,
        productName: name,
        invoiceUnitNormalized: invoiceU,
        products,
        itemEan,
        itemNcm: it.ncm,
        eanLookupKeys,
        companyId,
        supplierId,
        supabase,
        supplierHints,
      });

      const batchOut = buildImportBatchMatchOutput({
        it,
        name,
        invoiceU,
        batchResult,
        products,
        thresholds,
        autoApplyGlobalMassVolume,
        rulesByProduct,
        rawUnit,
      });
      if (batchOut.productMatch?.needsConfirmation) {
        requiresProductConfirmation = true;
      }
      if (batchOut.productId) {
        await upsertProductSupplierCode(
          supabase,
          companyId,
          supplierId,
          cProd,
          batchOut.productId,
        );
      }
      out.push(batchOut);
      continue;
    }

    // WhatsApp / interativo: identificadores do XML; senão produto novo (confirmação).
    const xmlMatch = await matchExistingProductFromNfeXmlLine({
      supabase,
      companyId,
      supplierId,
      supplierHints,
      catalog: products,
      line: {
        nome: name,
        codigo: cProd,
        ean: itemEan,
        ncm: it.ncm ?? null,
        unidade_comercial: it.unitCommercial ?? null,
        unidade_tributavel: it.unitTax ?? null,
        quantidade_comercial: it.quantityCommercial ?? it.quantity,
        quantidade_tributavel: it.quantityTax ?? null,
        quantidade: it.quantity,
      },
    });
    if (xmlMatch) {
      const p = productById.get(xmlMatch.productId);
      if (p) {
        const catU = normalizeUnitLabel(p.unit);
        const prules = rulesByProduct.get(p.id) ?? [];
        const mXml = enrichProductMatch(
          it,
          {
            resolvedProductId: p.id,
            suggestedProductId: p.id,
            suggestedProductName: p.name,
            suggestedScore: 100,
            needsConfirmation: false,
            resolutionStatus: "AUTO_MATCH",
            matchReason: `Identificadores do XML (${xmlMatch.criterio}) iguais ao cadastro`,
            invoiceUnitNormalized: invoiceU,
            catalogUnitNormalized: catU,
            unitConvertible: false,
            decisionPath: `direct_xml_${xmlMatch.criterio}`,
          },
          p,
          invoiceU,
          autoApplyGlobalMassVolume,
          prules,
          null,
        );
        if (mXml.needsConfirmation) requiresProductConfirmation = true;
        out.push({
          ...it,
          productId: mXml.resolvedProductId,
          productMatch: mXml,
        });
        if (mXml.resolvedProductId) {
          await upsertProductSupplierCode(
            supabase,
            companyId,
            supplierId,
            cProd,
            mXml.resolvedProductId,
          );
        }
        continue;
      }
    }

    requiresProductConfirmation = true;
    const suggestedName =
      finalizeSuggestedCatalogName(name.trim()) ?? name.trim();
    out.push({
      ...it,
      productId: null,
      productMatch: {
        resolvedProductId: null,
        suggestedProductId: null,
        suggestedProductName: null,
        suggestedScore: 0,
        needsConfirmation: true,
        resolutionStatus: "NEW_PRODUCT_STAGED",
        matchReason:
          "Sem produto pelos identificadores do XML — cadastro novo pendente de confirmação",
        invoiceUnitNormalized: invoiceU,
        catalogUnitNormalized: "UNKN",
        unitConvertible: false,
        decisionPath: "deterministic_new_product",
        borderlineLlmSuggestedName: suggestedName,
      },
    });
  }

  return {
    items: out,
    requiresProductConfirmation,
    deferProductCreationToReconciliation,
    borderlineLlmCalls: 0,
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

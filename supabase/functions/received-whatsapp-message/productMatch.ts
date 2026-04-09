import type { ExtractedExpenseItem } from "../_shared/openaiExpense.ts";
import {
  applySecondarySignals,
  scoreNameMatch,
} from "../_shared/productImport/matchingScore.ts";
import {
  canonicalProductName,
  normalizeInvoiceProductLabel,
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
} from "../_shared/productImport/unitConversion.ts";
import {
  conversionFactorToA,
  normalizeUnitLabel,
  unitsAreConvertible,
  unitsAreEqual,
  type NormalizedUnitCode,
} from "../_shared/productImport/unitNormalize.ts";

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
  };
};

export type ResolveProductMatchesResult = {
  items: ItemWithProductMatch[];
  requiresProductConfirmation: boolean;
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

async function loadImportSettings(
  supabase: SupabaseClient,
  companyId: string,
): Promise<{
  thresholds: ImportMatchThresholds;
  autoApplyGlobalMassVolume: boolean;
}> {
  const { data, error } = await supabase
    .from("company_product_import_settings")
    .select(
      "auto_match_min_score, confirm_min_score, auto_apply_global_mass_volume",
    )
    .eq("company_id", companyId)
    .maybeSingle();

  if (error || !data) {
    return {
      thresholds: clampThresholds(DEFAULT_IMPORT_MATCH_THRESHOLDS),
      autoApplyGlobalMassVolume: false,
    };
  }
  const d = data as {
    auto_match_min_score?: number;
    confirm_min_score?: number;
    auto_apply_global_mass_volume?: boolean;
  };
  return {
    thresholds: clampThresholds({
      autoMatchMinScore: d.auto_match_min_score,
      confirmMinScore: d.confirm_min_score,
    }),
    autoApplyGlobalMassVolume: !!d.auto_apply_global_mass_volume,
  };
}

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
  const c = computeStockQuantity({
    invoiceQuantity: Number(it.quantity),
    invoiceUnit: invoiceU,
    productUnitRaw: product.unit,
    autoApplyGlobalMassVolume: autoGlobal,
    productRule: rule,
  });
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
      ? `${partial.matchReason} · estoque: ${c.stockQuantity} (${c.resolutionSource})`
      : `estoque: ${c.stockQuantity} (${c.resolutionSource})`,
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
      matchReason: `Score ${bestScore.toFixed(1)} ≥ ${auto} e unidade compatível (${invoiceU})`,
    };
  }

  if (bestScore >= auto && invoiceU === "UNKN") {
    return {
      resolutionStatus: "AUTO_MATCH",
      needsConfirmation: false,
      unitConvertible: false,
      matchReason:
        `Score ${bestScore.toFixed(1)} ≥ ${auto}; unidade da nota ausente — vínculo por nome forte (cadastro ${catalogU})`,
    };
  }

  if (bestScore >= auto && !same && conv) {
    return {
      resolutionStatus: "UNIT_CONFLICT_PENDING",
      needsConfirmation: true,
      unitConvertible: true,
      matchReason:
        `Score ${bestScore.toFixed(1)} ≥ ${auto}, mas unidade da nota (${invoiceU}) difere do cadastro (${catalogU}); conversão não automática`,
    };
  }

  if (bestScore >= auto && !same && !conv) {
    return {
      resolutionStatus: "UNIT_CONFLICT_PENDING",
      needsConfirmation: true,
      unitConvertible: false,
      matchReason:
        `Score ${bestScore.toFixed(1)} ≥ ${auto}, mas unidades ${invoiceU} vs ${catalogU} exigem confirmação`,
    };
  }

  if (bestScore >= conf) {
    return {
      resolutionStatus: "PENDING_USER_CONFIRM",
      needsConfirmation: true,
      unitConvertible: conv,
      matchReason:
        `Score ${bestScore.toFixed(1)} entre ${conf} e ${auto - 1}; confirmação recomendada`,
    };
  }

  return {
    resolutionStatus: "NEW_PRODUCT_STAGED",
    needsConfirmation: true,
    unitConvertible: false,
    matchReason: `Score ${bestScore.toFixed(1)} < ${conf}; tratar como novo produto`,
  };
}

export async function resolveProductMatches(
  supabase: SupabaseClient,
  companyId: string,
  items: ExtractedExpenseItem[],
): Promise<ResolveProductMatchesResult> {
  const { thresholds, autoApplyGlobalMassVolume } = await loadImportSettings(
    supabase,
    companyId,
  );

  const merged = consolidateInvoiceItems(
    items as ExtractedItemWithInvoiceMeta[],
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

    let bestScore = 0;
    let bestProduct: ProductRow | null = null;
    let matchReason = "";

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
      const extra = sec.reasons.length ? `; ${sec.reasons.join("; ")}` : "";
      if (sc > bestScore) {
        bestScore = sc;
        bestProduct = p;
        matchReason = `Melhor candidato: score ${sc.toFixed(1)}${extra}`;
      }
    }

    if (!bestProduct) {
      requiresProductConfirmation = true;
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
          matchReason: "Catálogo vazio ou sem candidato",
          invoiceUnitNormalized: invoiceU,
          catalogUnitNormalized: "UNKN",
          unitConvertible: false,
        },
      });
      continue;
    }

    const catU = normalizeUnitLabel(bestProduct.unit);
    const decision = decideWithUnits({
      thresholds,
      bestScore,
      invoiceU,
      catalogU,
      hasCandidate: true,
    });

    let resolvedId: string | null = null;
    if (
      decision.resolutionStatus === "AUTO_MATCH" &&
      !decision.needsConfirmation
    ) {
      resolvedId = bestProduct.id;
    }

    const needsConfirmation = decision.needsConfirmation ||
      resolvedId == null;

    if (needsConfirmation) {
      requiresProductConfirmation = true;
    }

    const confMin = thresholds.confirmMinScore;
    const suggestedIdOut =
      bestScore >= confMin ? bestProduct.id : null;
    const suggestedNameOut =
      bestScore >= confMin ? bestProduct.name : null;

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
        matchReason: decision.matchReason + (matchReason ? ` (${matchReason})` : ""),
        invoiceUnitNormalized: invoiceU,
        catalogUnitNormalized: catU,
        unitConvertible: decision.unitConvertible,
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

  return { items: out, requiresProductConfirmation };
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

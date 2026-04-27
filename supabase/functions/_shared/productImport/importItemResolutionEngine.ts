/**
 * Mantido alinhado a web/src/lib/productImport/importItemResolutionEngine.ts
 * (motor de resolução XML/NF-e antes do estoque).
 */

import { importNameHeuristicBlocksRecipePath, matchStrongNegativeLabels } from "../itemClassification/namingImportSignals.ts";
import type { OperationalItemType } from "../itemClassification/operationalItemTypes.ts";
import { buildMasterImportReasons } from "../masterItemCatalog/resolveMasterItemCatalog.ts";
import { buildMasterRecipeImportReasons } from "../masterRecipeCatalog/suggestMasterRecipeTemplate.ts";
import type { CompanyMasterCatalogOverrideInput } from "../masterItemCatalog/companyContext.ts";
import { canonicalProductName } from "./canonicalName.ts";
import type { ImportMatchThresholds } from "./matchConfig.ts";

export type ImportNature =
  | "INSUMO"
  | "ESTOQUE_DIRETO"
  | "COMPOSTO"
  | "EXPLODIR_POR_FICHA"
  | "REVISAO_MANUAL";

export type ImportEngineSuggestion =
  | "AUTO_MATCH_INSUMO"
  | "AUTO_MATCH_ESTOQUE_DIRETO"
  | "AUTO_SUGESTAO_EXPLODIR_FICHA"
  | "AUTO_APPLY_EXPLODIR_FICHA"
  | "REVISAO_MANUAL";

export type StockControlType = "DIRECT" | "RECIPE_CONTROLLED" | "COMPOSITE" | "SERVICE";

export type ImportResolutionRuleRow = {
  id: string;
  supplier_id: string | null;
  raw_description_pattern: string | null;
  normalized_description: string | null;
  ean: string | null;
  ncm: string | null;
  resolution_mode: "DIRECT_STOCK_ENTRY" | "EXPLODE_BY_RECIPE" | "REVIEW_REQUIRED";
  target_product_id: string | null;
  target_recipe_id: string | null;
  auto_apply: boolean;
  confidence_override: number | null;
};

export type EntryBreakdownRecipeRow = {
  id: string;
  output_product_id: string | null;
  batch_yield: number;
  active: boolean;
  recipe_type: string;
  version: number;
};

export type ProductStockRow = {
  id: string;
  stock_control_type: StockControlType;
};

export type ProductMatchLike = {
  resolvedProductId: string | null;
  suggestedProductId: string | null;
  suggestedScore: number;
  needsConfirmation: boolean;
  resolutionStatus: string;
  matchReason?: string;
};

export type XmlLineForResolution = {
  productName: string;
  quantity: number;
  unitCommercial?: string | null;
  ncm?: string | null;
  ean?: string | null;
  productMatch?: ProductMatchLike;
};

export type ResolveXmlImportLineInput = {
  companyId: string;
  supplierId: string | null;
  item: XmlLineForResolution;
  rules: ImportResolutionRuleRow[];
  productsById: Map<string, ProductStockRow>;
  entryBreakdownRecipes: EntryBreakdownRecipeRow[];
  thresholds: ImportMatchThresholds;
  masterImportHints?: {
    companyOverrides?: CompanyMasterCatalogOverrideInput[] | null;
    lineLearning?: {
      normalizedKey: string;
      tallies: Partial<Record<OperationalItemType, number>>;
    } | null;
  } | null;
};

export type ResolveXmlImportLineResult = {
  import_nature: ImportNature;
  import_engine_suggestion: ImportEngineSuggestion;
  import_confidence_0_1: number;
  import_score_reasons_json: Record<string, unknown>;
  import_stock_resolution: "DIRECT" | "EXPLODE_BY_RECIPE" | null;
  resolved_entry_breakdown_recipe_id: string | null;
  import_pending_resolution: boolean;
  target_product_id: string | null;
  import_applied_rule_id: string | null;
};

function scoreTo01(score0to100: number): number {
  return Math.min(1, Math.max(0, score0to100 / 100));
}

function withMasterImportAudit(
  productName: string,
  reasons: Record<string, unknown>,
  hints: ResolveXmlImportLineInput["masterImportHints"] | undefined,
): Record<string, unknown> {
  return {
    ...reasons,
    ...buildMasterImportReasons(productName, {
      companyOverrides: hints?.companyOverrides,
      lineLearning: hints?.lineLearning
        ? { normalized_key: hints.lineLearning.normalizedKey, tallies: hints.lineLearning.tallies }
        : null,
    }),
    ...buildMasterRecipeImportReasons(productName),
  };
}

function findLearnedRule(
  rules: ImportResolutionRuleRow[],
  supplierId: string | null,
  canon: string,
  rawName: string,
  ean: string | null,
  ncm: string | null,
): ImportResolutionRuleRow | null {
  const eanL = ean?.trim() || null;
  const ncmL = ncm?.trim() || null;
  const rawLower = rawName.toLowerCase();

  for (const r of rules) {
    if (r.ean && eanL && r.ean.trim() === eanL) {
      if (!r.supplier_id || r.supplier_id === supplierId) return r;
    }
  }
  for (const r of rules) {
    if (r.ncm && ncmL && r.ncm.trim() === ncmL) {
      if (!r.supplier_id || r.supplier_id === supplierId) return r;
    }
  }
  if (supplierId) {
    for (const r of rules) {
      if (r.supplier_id === supplierId && r.normalized_description && r.normalized_description === canon) {
        return r;
      }
    }
  }
  for (const r of rules) {
    if (!r.supplier_id && r.normalized_description && r.normalized_description === canon) return r;
  }
  if (supplierId) {
    for (const r of rules) {
      const p = r.raw_description_pattern?.trim();
      if (r.supplier_id === supplierId && p && rawLower.includes(p.toLowerCase())) return r;
    }
  }
  return null;
}

function pickEntryBreakdownForProduct(
  recipes: EntryBreakdownRecipeRow[],
  productId: string,
): EntryBreakdownRecipeRow | null {
  const list = recipes.filter(
    (x) =>
      x.recipe_type === "ENTRY_BREAKDOWN" &&
      x.output_product_id === productId &&
      x.active === true &&
      x.batch_yield > 0,
  );
  if (!list.length) return null;
  return list.sort((a, b) => b.version - a.version)[0] ?? null;
}

function natureForProduct(t: StockControlType): ImportNature {
  if (t === "COMPOSITE") return "COMPOSTO";
  if (t === "SERVICE") return "INSUMO";
  if (t === "RECIPE_CONTROLLED") return "EXPLODIR_POR_FICHA";
  return "ESTOQUE_DIRETO";
}

export function resolveXmlImportLine(input: ResolveXmlImportLineInput): ResolveXmlImportLineResult {
  const { supplierId, item, rules, productsById, entryBreakdownRecipes, thresholds, masterImportHints } = input;
  const pm = item.productMatch;
  const reasons: Record<string, unknown> = {};
  const autoT = thresholds.autoMatchMinScore / 100;
  const confT = thresholds.confirmMinScore / 100;

  const canon = canonicalProductName(item.productName);
  const learned = findLearnedRule(rules, supplierId, canon, item.productName, item.ean ?? null, item.ncm ?? null);

  if (learned) {
    reasons.learned_rule_id = learned.id;
    reasons.learned_mode = learned.resolution_mode;
    const ov = learned.confidence_override != null ? Number(learned.confidence_override) : null;
    const baseConf = ov != null && Number.isFinite(ov) ? Math.min(1, Math.max(0, ov)) : 0.98;

    if (learned.resolution_mode === "REVIEW_REQUIRED") {
      return {
        import_nature: "REVISAO_MANUAL",
        import_engine_suggestion: "REVISAO_MANUAL",
        import_confidence_0_1: baseConf,
        import_score_reasons_json: withMasterImportAudit(item.productName, reasons, masterImportHints),
        import_stock_resolution: null,
        resolved_entry_breakdown_recipe_id: null,
        import_pending_resolution: true,
        target_product_id: learned.target_product_id,
        import_applied_rule_id: learned.id,
      };
    }

    if (learned.resolution_mode === "EXPLODE_BY_RECIPE") {
      return {
        import_nature: "REVISAO_MANUAL",
        import_engine_suggestion: "REVISAO_MANUAL",
        import_confidence_0_1: baseConf,
        import_score_reasons_json: withMasterImportAudit(
          item.productName,
          { ...reasons, xml_recipe_path_disabled: true, learned_recipe_mode: true },
          masterImportHints,
        ),
        import_stock_resolution: null,
        resolved_entry_breakdown_recipe_id: null,
        import_pending_resolution: true,
        target_product_id: learned.target_product_id,
        import_applied_rule_id: learned.id,
      };
    }

    if (learned.resolution_mode === "DIRECT_STOCK_ENTRY" && learned.target_product_id) {
      const p = productsById.get(learned.target_product_id);
      return {
        import_nature: p ? natureForProduct(p.stock_control_type) : "ESTOQUE_DIRETO",
        import_engine_suggestion: learned.auto_apply ? "AUTO_MATCH_ESTOQUE_DIRETO" : "REVISAO_MANUAL",
        import_confidence_0_1: baseConf,
        import_score_reasons_json: withMasterImportAudit(item.productName, reasons, masterImportHints),
        import_stock_resolution: "DIRECT",
        resolved_entry_breakdown_recipe_id: null,
        import_pending_resolution: !learned.auto_apply,
        target_product_id: learned.target_product_id,
        import_applied_rule_id: learned.id,
      };
    }
  }

  if (!pm) {
    return {
      import_nature: "REVISAO_MANUAL",
      import_engine_suggestion: "REVISAO_MANUAL",
      import_confidence_0_1: 0,
      import_score_reasons_json: withMasterImportAudit(
        item.productName,
        { ...reasons, note: "missing_product_match" },
        masterImportHints,
      ),
      import_stock_resolution: null,
      resolved_entry_breakdown_recipe_id: null,
      import_pending_resolution: true,
      target_product_id: null,
      import_applied_rule_id: null,
    };
  }

  if (pm.needsConfirmation) {
    reasons.product_match = pm.resolutionStatus;
    reasons.match_reason = pm.matchReason;
    return {
      import_nature: "REVISAO_MANUAL",
      import_engine_suggestion: "REVISAO_MANUAL",
      import_confidence_0_1: scoreTo01(pm.suggestedScore),
      import_score_reasons_json: withMasterImportAudit(item.productName, reasons, masterImportHints),
      import_stock_resolution: null,
      resolved_entry_breakdown_recipe_id: null,
      import_pending_resolution: true,
      target_product_id: pm.resolvedProductId ?? pm.suggestedProductId,
      import_applied_rule_id: null,
    };
  }

  const pid = pm.resolvedProductId ?? pm.suggestedProductId;
  const conf = scoreTo01(pm.suggestedScore);
  reasons.catalog_match_score = pm.suggestedScore;
  reasons.match_reason = pm.matchReason;

  if (!pid) {
    return {
      import_nature: "REVISAO_MANUAL",
      import_engine_suggestion: "REVISAO_MANUAL",
      import_confidence_0_1: conf,
      import_score_reasons_json: withMasterImportAudit(item.productName, reasons, masterImportHints),
      import_stock_resolution: null,
      resolved_entry_breakdown_recipe_id: null,
      import_pending_resolution: true,
      target_product_id: null,
      import_applied_rule_id: null,
    };
  }

  const prod = productsById.get(pid);
  const stockType = prod?.stock_control_type ?? "DIRECT";
  const breakdown = pickEntryBreakdownForProduct(entryBreakdownRecipes, pid);

  if (importNameHeuristicBlocksRecipePath(item.productName) && (stockType === "RECIPE_CONTROLLED" || stockType === "COMPOSITE") && breakdown) {
    return {
      import_nature: "REVISAO_MANUAL",
      import_engine_suggestion: "REVISAO_MANUAL",
      import_confidence_0_1: conf,
      import_score_reasons_json: withMasterImportAudit(
        item.productName,
        { ...reasons, name_block_recipe_path: true, name_negative_labels: matchStrongNegativeLabels(item.productName) },
        masterImportHints,
      ),
      import_stock_resolution: null,
      resolved_entry_breakdown_recipe_id: null,
      import_pending_resolution: true,
      target_product_id: pid,
      import_applied_rule_id: null,
    };
  }

  if (breakdown && (stockType === "RECIPE_CONTROLLED" || stockType === "COMPOSITE")) {
    return {
      import_nature: "REVISAO_MANUAL",
      import_engine_suggestion: "REVISAO_MANUAL",
      import_confidence_0_1: conf,
      import_score_reasons_json: withMasterImportAudit(
        item.productName,
        { ...reasons, xml_recipe_path_disabled: true, entry_breakdown_recipe_id: breakdown.id },
        masterImportHints,
      ),
      import_stock_resolution: null,
      resolved_entry_breakdown_recipe_id: null,
      import_pending_resolution: true,
      target_product_id: pid,
      import_applied_rule_id: null,
    };
  }

  if (stockType === "RECIPE_CONTROLLED" || stockType === "COMPOSITE") {
    return {
      import_nature: "REVISAO_MANUAL",
      import_engine_suggestion: "REVISAO_MANUAL",
      import_confidence_0_1: conf,
      import_score_reasons_json: withMasterImportAudit(
        item.productName,
        { ...reasons, block_reason: "missing_active_entry_breakdown_recipe" },
        masterImportHints,
      ),
      import_stock_resolution: null,
      resolved_entry_breakdown_recipe_id: null,
      import_pending_resolution: true,
      target_product_id: pid,
      import_applied_rule_id: null,
    };
  }

  const insumoLike = stockType === "SERVICE";
  const suggestion: ImportEngineSuggestion = insumoLike
    ? "AUTO_MATCH_INSUMO"
    : conf >= autoT
      ? "AUTO_MATCH_ESTOQUE_DIRETO"
      : conf >= confT
        ? "AUTO_MATCH_ESTOQUE_DIRETO"
        : "REVISAO_MANUAL";

  return {
    import_nature: insumoLike ? "INSUMO" : "ESTOQUE_DIRETO",
    import_engine_suggestion: suggestion,
    import_confidence_0_1: conf,
    import_score_reasons_json: withMasterImportAudit(item.productName, reasons, masterImportHints),
    import_stock_resolution: conf >= autoT ? "DIRECT" : null,
    resolved_entry_breakdown_recipe_id: null,
    import_pending_resolution: conf < autoT,
    target_product_id: pid,
    import_applied_rule_id: null,
  };
}

export function previewEntryBreakdownQuantities(params: {
  invoiceStockBasisQty: number;
  batchYield: number;
  ingredients: Array<{
    qtyPerBatchInStockUnit: number;
    lossFactor?: number;
  }>;
}): { scale: number; componentQtys: number[] } {
  const { invoiceStockBasisQty, batchYield, ingredients } = params;
  const scale = invoiceStockBasisQty / batchYield;
  const componentQtys = ingredients.map((i) => i.qtyPerBatchInStockUnit * scale * (i.lossFactor ?? 1));
  return { scale, componentQtys };
}

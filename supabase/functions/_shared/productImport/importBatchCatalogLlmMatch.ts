/**
 * Vínculo de linha NF-e em importação em lote: match direto (EAN / NCM+nome) ou IA com catálogo completo.
 */
import type { ExtractedExpenseItem } from "../openaiExpense.ts";
import { sanitizeCatalogProductName } from "./canonicalName.ts";
import {
  buildLlmCatalogForInvoiceLine,
  catalogToLlmArbiterCandidates,
  findCatalogProductByNormalizedName,
  findDirectMatchByEan,
  findDirectMatchByNcmAndName,
} from "./llmCatalogCandidates.ts";
import { assistNfeRagArbiterMatch } from "./productMatchLlmAssist.ts";
import type { ImportMatchThresholds } from "./matchConfig.ts";
import { normalizeUnitLabel } from "./unitNormalize.ts";

export type ImportBatchCatalogProduct = {
  id: string;
  name: string;
  unit: string | null;
  barcode?: string | null;
  ncm?: string | null;
};

export type ImportBatchCatalogLlmMatchInput = {
  item: ExtractedExpenseItem;
  productName: string;
  invoiceUnitNormalized: string;
  products: ImportBatchCatalogProduct[];
  itemNcm?: string | null;
  itemEan?: string | null;
  openaiKey: string;
  openaiModel: string;
  thresholds: ImportMatchThresholds;
  eanLookupKeys: (raw: string | null | undefined) => string[];
  skipLlm?: boolean;
};

export type ImportBatchCatalogLlmMatchResult =
  | {
      kind: "DIRECT_EAN";
      product: ImportBatchCatalogProduct;
    }
  | {
      kind: "DIRECT_NCM_NAME";
      product: ImportBatchCatalogProduct;
    }
  | {
      kind: "LLM_LINK";
      product: ImportBatchCatalogProduct;
      rationale: string;
    }
  | {
      kind: "LLM_NEW_PRODUCT";
      suggestedCatalogName: string;
      rationale: string;
    }
  | {
      kind: "LLM_SKIP";
      rationale: string;
      fallbackSuggestedName?: string;
    }
  | {
      kind: "NO_OPENAI";
      fallbackSuggestedName: string;
    }
  | {
      kind: "EMPTY_CATALOG";
      fallbackSuggestedName: string;
    };

export async function matchImportBatchLineWithCatalogLlm(
  input: ImportBatchCatalogLlmMatchInput,
): Promise<ImportBatchCatalogLlmMatchResult> {
  const name = input.productName.trim() || "Item";
  const catalog = input.products;

  const eanHit = findDirectMatchByEan(catalog, input.itemEan, input.eanLookupKeys);
  if (eanHit) {
    return { kind: "DIRECT_EAN", product: eanHit };
  }

  const ncmNameHit = findDirectMatchByNcmAndName(
    catalog,
    input.itemNcm,
    name,
  );
  if (ncmNameHit) {
    return { kind: "DIRECT_NCM_NAME", product: ncmNameHit };
  }

  if (input.skipLlm || !input.openaiKey.trim()) {
    return {
      kind: "NO_OPENAI",
      fallbackSuggestedName: sanitizeCatalogProductName(name) || name,
    };
  }

  const llmCatalog = buildLlmCatalogForInvoiceLine(catalog, input.itemNcm);
  if (!llmCatalog.length) {
    return {
      kind: "EMPTY_CATALOG",
      fallbackSuggestedName: sanitizeCatalogProductName(name) || name,
    };
  }

  const candidates = catalogToLlmArbiterCandidates(
    llmCatalog.map((p) => ({
      id: p.id,
      name: p.name,
      unit: p.unit,
      ncm: p.ncm,
      barcode: p.barcode,
    })),
  );

  const rawUnit =
    (input.item as ExtractedExpenseItem & { invoiceUnitRaw?: string }).invoiceUnitRaw ??
    (input.item as ExtractedExpenseItem & { unitCommercial?: string }).unitCommercial ??
    null;

  const arb = await assistNfeRagArbiterMatch(input.openaiKey, input.openaiModel, {
    invoice_description: name,
    invoice_unit_raw: rawUnit,
    invoice_ean: input.itemEan ? String(input.itemEan) : null,
    invoice_ncm: input.itemNcm ? String(input.itemNcm) : null,
    candidates,
  });

  if (arb.kind === "LINK") {
    const product = catalog.find((p) => p.id === arb.product_id);
    if (product) {
      return { kind: "LLM_LINK", product, rationale: arb.rationale };
    }
    return {
      kind: "LLM_SKIP",
      rationale: `LINK fora do catálogo: ${arb.rationale}`,
      fallbackSuggestedName: sanitizeCatalogProductName(name) || name,
    };
  }

  if (arb.kind === "NEW_PRODUCT") {
    const existing = findCatalogProductByNormalizedName(
      catalog,
      arb.suggested_catalog_name,
      name,
    );
    if (existing) {
      return {
        kind: "LLM_LINK",
        product: existing,
        rationale: `Nome normalizado coincide com cadastro (${arb.suggested_catalog_name}): ${arb.rationale}`,
      };
    }
    return {
      kind: "LLM_NEW_PRODUCT",
      suggestedCatalogName: arb.suggested_catalog_name,
      rationale: arb.rationale,
    };
  }

  return {
    kind: "LLM_SKIP",
    rationale: arb.kind === "ERROR" ? arb.message : arb.rationale,
    fallbackSuggestedName: sanitizeCatalogProductName(name) || name,
  };
}

export function importBatchCatalogProductUnit(p: ImportBatchCatalogProduct): string {
  return normalizeUnitLabel(p.unit);
}

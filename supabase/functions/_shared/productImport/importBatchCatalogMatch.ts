/**
 * Vínculo de linha NF-e em importação em lote: usa identificadores do XML
 * (EAN, cProd+fornecedor, SKU, nome, NCM, histórico); senão produto novo.
 */
import type { ExtractedExpenseItem } from "../openaiExpense.ts";
import { sanitizeCatalogProductName } from "./canonicalName.ts";
import {
  matchExistingProductFromNfeXmlLine,
  type MatchExistingNfeProductCriterio,
  type SupplierProductMatchHints,
} from "./matchExistingProductFromNfeXml.ts";
import { normalizeCProd } from "./productSupplierCodes.ts";
import { normalizeUnitLabel } from "./unitNormalize.ts";

export type ImportBatchCatalogProduct = {
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

export type ImportBatchCatalogMatchInput = {
  item: ExtractedExpenseItem;
  productName: string;
  invoiceUnitNormalized: string;
  products: ImportBatchCatalogProduct[];
  itemNcm?: string | null;
  itemEan?: string | null;
  eanLookupKeys: (raw: string | null | undefined) => string[];
  companyId?: string;
  supplierId?: string | null;
  // deno-lint-ignore no-explicit-any
  supabase?: any;
  supplierHints?: SupplierProductMatchHints | null;
};

export type ImportBatchCatalogMatchResult =
  | {
      kind: "DIRECT_EAN";
      product: ImportBatchCatalogProduct;
      criterio: MatchExistingNfeProductCriterio;
    }
  | {
      kind: "DIRECT_CPROD_SUPPLIER";
      product: ImportBatchCatalogProduct;
      criterio: MatchExistingNfeProductCriterio;
    }
  | {
      kind: "DIRECT_XML_IDENTITY";
      product: ImportBatchCatalogProduct;
      criterio: MatchExistingNfeProductCriterio;
    }
  | {
      kind: "NEW_PRODUCT";
      fallbackSuggestedName: string;
      rationale: string;
    };

function kindForCriterio(
  criterio: MatchExistingNfeProductCriterio,
): "DIRECT_EAN" | "DIRECT_CPROD_SUPPLIER" | "DIRECT_XML_IDENTITY" {
  if (criterio === "ean") return "DIRECT_EAN";
  if (criterio === "cprod_fornecedor") return "DIRECT_CPROD_SUPPLIER";
  return "DIRECT_XML_IDENTITY";
}

export async function matchImportBatchLineWithCatalog(
  input: ImportBatchCatalogMatchInput,
): Promise<ImportBatchCatalogMatchResult> {
  const name = input.productName.trim() || "Item";
  const catalog = input.products;
  const suggested = sanitizeCatalogProductName(name) || name;
  const cProd = normalizeCProd(
    input.item.productCode ??
      (input.item as ExtractedExpenseItem & { codigo?: string | null }).codigo,
  );

  const matched = await matchExistingProductFromNfeXmlLine({
    supabase: input.supabase,
    companyId: input.companyId,
    supplierId: input.supplierId,
    supplierHints: input.supplierHints,
    catalog,
    line: {
      nome: name,
      codigo: cProd,
      ean: input.itemEan ?? input.item.ean ?? null,
      ncm: input.itemNcm ?? input.item.ncm ?? null,
      unidade_comercial: input.item.unitCommercial ?? null,
      unidade_tributavel: input.item.unitTax ?? null,
      quantidade_comercial: input.item.quantityCommercial ?? input.item.quantity,
      quantidade_tributavel: input.item.quantityTax ?? null,
      quantidade: input.item.quantity,
    },
  });

  if (matched) {
    const product = catalog.find((p) => p.id === matched.productId);
    if (product) {
      const kind = kindForCriterio(matched.criterio);
      return { kind, product, criterio: matched.criterio };
    }
  }

  return {
    kind: "NEW_PRODUCT",
    fallbackSuggestedName: suggested,
    rationale:
      "Sem produto pelos identificadores do XML (EAN, cProd+fornecedor, SKU, nome, NCM, histórico) — cadastro novo.",
  };
}

export function importBatchCatalogProductUnit(p: ImportBatchCatalogProduct): string {
  return normalizeUnitLabel(p.unit);
}

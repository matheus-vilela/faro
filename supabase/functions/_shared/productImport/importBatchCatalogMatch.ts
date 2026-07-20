/**
 * Vínculo de linha NF-e em importação em lote: só EAN ou cProd+fornecedor; senão produto novo.
 */
import type { ExtractedExpenseItem } from "../openaiExpense.ts";
import { sanitizeCatalogProductName } from "./canonicalName.ts";
import { findDirectMatchByEan } from "./llmCatalogCandidates.ts";
import {
  findProductIdBySupplierCProd,
  normalizeCProd,
} from "./productSupplierCodes.ts";
import { normalizeUnitLabel } from "./unitNormalize.ts";

export type ImportBatchCatalogProduct = {
  id: string;
  name: string;
  unit: string | null;
  barcode?: string | null;
  ean?: string | null;
  ncm?: string | null;
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
};

export type ImportBatchCatalogMatchResult =
  | {
      kind: "DIRECT_EAN";
      product: ImportBatchCatalogProduct;
    }
  | {
      kind: "DIRECT_CPROD_SUPPLIER";
      product: ImportBatchCatalogProduct;
    }
  | {
      kind: "NEW_PRODUCT";
      fallbackSuggestedName: string;
      rationale: string;
    };

export async function matchImportBatchLineWithCatalog(
  input: ImportBatchCatalogMatchInput,
): Promise<ImportBatchCatalogMatchResult> {
  const name = input.productName.trim() || "Item";
  const catalog = input.products;
  const suggested = sanitizeCatalogProductName(name) || name;

  const eanHit = findDirectMatchByEan(catalog, input.itemEan, input.eanLookupKeys);
  if (eanHit) {
    return { kind: "DIRECT_EAN", product: eanHit };
  }

  const cProd = normalizeCProd(
    input.item.productCode ??
      (input.item as ExtractedExpenseItem & { codigo?: string | null }).codigo,
  );
  const supplierId = input.supplierId != null
    ? String(input.supplierId).trim()
    : "";
  if (
    cProd &&
    supplierId &&
    input.supabase &&
    input.companyId
  ) {
    const productId = await findProductIdBySupplierCProd(
      input.supabase,
      input.companyId,
      supplierId,
      cProd,
    );
    if (productId) {
      const product = catalog.find((p) => p.id === productId);
      if (product) {
        return { kind: "DIRECT_CPROD_SUPPLIER", product };
      }
    }
  }

  return {
    kind: "NEW_PRODUCT",
    fallbackSuggestedName: suggested,
    rationale:
      "Sem produto por EAN ou cProd+fornecedor — cadastro automático com nome da nota.",
  };
}

export function importBatchCatalogProductUnit(p: ImportBatchCatalogProduct): string {
  return normalizeUnitLabel(p.unit);
}

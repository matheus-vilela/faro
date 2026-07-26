/**
 * Match NF-e ancorado no fornecedor.
 * Só vincula produto já relacionado a esse fornecedor, com certeza via:
 * cProd → EAN → SKU(=cProd).
 * EAN/SKU existentes na empresa sem vínculo com o fornecedor NÃO vinculam.
 */
import {
  eanLookupKeys,
  findDirectMatchByEan,
} from "./llmCatalogCandidates.ts";
import {
  findProductIdBySupplierCProd,
  normalizeCProd,
} from "./productSupplierCodes.ts";
import type {
  MatchExistingNfeProductCatalogRow,
  MatchExistingNfeProductResult,
  NfeXmlLineIdentity,
  SupplierProductMatchHints,
} from "./matchExistingProductFromNfeXml.ts";
import { loadSupplierProductMatchHints } from "./matchExistingProductFromNfeXml.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export type SupplierCertaintyCriterio =
  | "cprod_fornecedor"
  | "ean_fornecedor"
  | "sku_igual_cprod_fornecedor";

export type MatchProductBySupplierCertaintyResult = {
  productId: string;
  productName: string | null;
  criterio: SupplierCertaintyCriterio;
};

function activeCatalog(
  catalog: MatchExistingNfeProductCatalogRow[],
): MatchExistingNfeProductCatalogRow[] {
  return catalog.filter((p) => p.is_active !== false);
}

function supplierScopedCatalog(
  catalog: MatchExistingNfeProductCatalogRow[],
  relatedIds: Set<string>,
): MatchExistingNfeProductCatalogRow[] {
  if (relatedIds.size === 0) return [];
  return activeCatalog(catalog).filter((p) => relatedIds.has(p.id));
}

function findBySkuInScoped(
  scoped: MatchExistingNfeProductCatalogRow[],
  cProd: string | null,
): MatchExistingNfeProductCatalogRow | undefined {
  if (!cProd) return undefined;
  const code = cProd.trim().toLowerCase();
  if (!code) return undefined;
  return scoped.find((p) => {
    const sku = p.sku != null ? String(p.sku).trim().toLowerCase() : "";
    return sku.length > 0 && sku === code;
  });
}

/**
 * Resolve produto já cadastrado **para este fornecedor**.
 * Sem supplierId → null (cria novo).
 */
export async function matchProductBySupplierCertainty(input: {
  supabase: SupabaseClient;
  companyId: string;
  supplierId: string | null | undefined;
  line: NfeXmlLineIdentity;
  catalog: MatchExistingNfeProductCatalogRow[];
  /** Se omitido, carrega preferredProductIds do fornecedor. */
  supplierHints?: SupplierProductMatchHints | null;
}): Promise<MatchProductBySupplierCertaintyResult | null> {
  const sid = input.supplierId != null ? String(input.supplierId).trim() : "";
  if (!sid) return null;

  const hints = input.supplierHints ??
    await loadSupplierProductMatchHints(
      input.supabase,
      input.companyId,
      sid,
    );
  const relatedIds = hints.preferredProductIds;
  const scoped = supplierScopedCatalog(input.catalog, relatedIds);
  const cProd = normalizeCProd(input.line.codigo);

  // 1) cProd do fornecedor (fonte de verdade do vínculo)
  if (cProd) {
    const byCProd = await findProductIdBySupplierCProd(
      input.supabase,
      input.companyId,
      sid,
      cProd,
    );
    if (byCProd) {
      const hit = activeCatalog(input.catalog).find((p) => p.id === byCProd);
      if (hit) {
        relatedIds.add(byCProd);
        return {
          productId: byCProd,
          productName: hit.name,
          criterio: "cprod_fornecedor",
        };
      }
    }
  }

  // 2) EAN só entre produtos já do fornecedor
  if (scoped.length > 0) {
    const byEan = findDirectMatchByEan(scoped, input.line.ean, eanLookupKeys);
    if (byEan) {
      return {
        productId: byEan.id,
        productName: byEan.name,
        criterio: "ean_fornecedor",
      };
    }
  }

  // 3) SKU = cProd só entre produtos já do fornecedor
  if (scoped.length > 0) {
    const bySku = findBySkuInScoped(scoped, cProd);
    if (bySku) {
      return {
        productId: bySku.id,
        productName: bySku.name,
        criterio: "sku_igual_cprod_fornecedor",
      };
    }
  }

  return null;
}

/** Adapta resultado ao tipo legado usado no post-process (criterio compatível). */
export function toLegacyMatchResult(
  hit: MatchProductBySupplierCertaintyResult,
): MatchExistingNfeProductResult {
  const criterio =
    hit.criterio === "ean_fornecedor"
      ? "ean"
      : hit.criterio === "sku_igual_cprod_fornecedor"
      ? "sku_igual_cprod"
      : "cprod_fornecedor";
  return {
    productId: hit.productId,
    productName: hit.productName,
    criterio,
  };
}

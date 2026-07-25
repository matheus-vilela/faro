/**
 * Resolve se a linha da NF-e já existe no cadastro usando os identificadores do XML
 * (EAN, cProd+fornecedor, SKU, nome, NCM, aliases e histórico de compras do fornecedor).
 * Determinístico — sem IA.
 */
import { buildNewProductCatalogFromNfeLine } from "./buildPackUnitConversionsFromLabel.ts";
import {
  canonicalProductName,
  sanitizeCatalogProductName,
} from "./canonicalName.ts";
import {
  catalogMatchNameKey,
  eanLookupKeys,
  findDirectMatchByEan,
  findDirectMatchByNcmAndName,
  normalizeNcm8Digits,
} from "./llmCatalogCandidates.ts";
import { invoiceLabelMatchesMergedCatalog } from "./mergedCatalogMatch.ts";
import {
  findProductIdBySupplierCProd,
  normalizeCProd,
} from "./productSupplierCodes.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export type NfeXmlLineIdentity = {
  nome: string;
  codigo?: string | null;
  ean?: string | null;
  ncm?: string | null;
  unidade_comercial?: string | null;
  unidade_tributavel?: string | null;
  quantidade_comercial?: number | null;
  quantidade_tributavel?: number | null;
  quantidade?: number | null;
};

export type MatchExistingNfeProductCatalogRow = {
  id: string;
  name: string;
  ncm?: string | null;
  ean?: string | null;
  barcode?: string | null;
  sku?: string | null;
  canonical_name?: string | null;
  merged_catalog_names?: string[] | null;
  is_active?: boolean | null;
};

export type MatchExistingNfeProductCriterio =
  | "ean"
  | "cprod_fornecedor"
  | "sku_igual_cprod"
  | "canonical_name"
  | "ncm_e_nome"
  | "nome_catalogo"
  | "merged_catalog_names"
  | "historico_fornecedor";

export type MatchExistingNfeProductResult = {
  productId: string;
  productName: string | null;
  criterio: MatchExistingNfeProductCriterio;
};

export type SupplierProductMatchHints = {
  /** Produtos já vinculados a este fornecedor (cProd ou compras). */
  preferredProductIds: Set<string>;
  /** Nome canônico da linha de compra → product_id. */
  nameKeyToProductId: Map<string, string>;
};

/** Carrega indícios de produtos já comprados deste fornecedor (1x por nota/chunk). */
export async function loadSupplierProductMatchHints(
  supabase: SupabaseClient,
  companyId: string,
  supplierId: string | null | undefined,
): Promise<SupplierProductMatchHints> {
  const preferredProductIds = new Set<string>();
  const nameKeyToProductId = new Map<string, string>();
  const sid = supplierId != null ? String(supplierId).trim() : "";
  if (!sid) return { preferredProductIds, nameKeyToProductId };

  const { data: codeRows, error: codeErr } = await supabase
    .from("product_supplier_codes")
    .select("product_id")
    .eq("company_id", companyId)
    .eq("supplier_id", sid)
    .limit(5000);
  if (codeErr) {
    console.error(
      "[matchExistingProductFromNfeXml] supplier_codes_err",
      codeErr.message,
    );
  } else {
    for (const row of Array.isArray(codeRows) ? codeRows : []) {
      const pid = row?.product_id != null ? String(row.product_id) : "";
      if (pid) preferredProductIds.add(pid);
    }
  }

  const { data: expenses, error: expErr } = await supabase
    .from("expenses")
    .select("id")
    .eq("company_id", companyId)
    .eq("supplier_id", sid)
    .order("created_at", { ascending: false })
    .limit(300);
  if (expErr) {
    console.error(
      "[matchExistingProductFromNfeXml] supplier_expenses_err",
      expErr.message,
    );
    return { preferredProductIds, nameKeyToProductId };
  }

  const expIds = (Array.isArray(expenses) ? expenses : [])
    .map((e: { id?: string }) => (e?.id != null ? String(e.id) : ""))
    .filter(Boolean);
  if (expIds.length === 0) {
    return { preferredProductIds, nameKeyToProductId };
  }

  const { data: items, error: itemsErr } = await supabase
    .from("expense_items")
    .select("product_name, product_id")
    .in("expense_id", expIds)
    .not("product_id", "is", null)
    .limit(8000);
  if (itemsErr) {
    console.error(
      "[matchExistingProductFromNfeXml] supplier_items_err",
      itemsErr.message,
    );
    return { preferredProductIds, nameKeyToProductId };
  }

  for (const row of Array.isArray(items) ? items : []) {
    const pid = row?.product_id != null ? String(row.product_id) : "";
    if (!pid) continue;
    preferredProductIds.add(pid);
    const key = catalogMatchNameKey(String(row.product_name ?? ""));
    if (key.length >= 2 && !nameKeyToProductId.has(key)) {
      nameKeyToProductId.set(key, pid);
    }
  }

  return { preferredProductIds, nameKeyToProductId };
}

function activeCatalog<T extends MatchExistingNfeProductCatalogRow>(
  catalog: T[],
): T[] {
  return catalog.filter((p) => p.is_active !== false);
}

function registrationNameFromLine(line: NfeXmlLineIdentity): string {
  const built = buildNewProductCatalogFromNfeLine({
    productName: String(line.nome ?? "").trim() || "Item",
    invoiceUnitRaw: line.unidade_comercial,
    unitCommercial: line.unidade_comercial,
    unitTax: line.unidade_tributavel,
    quantityCommercial: line.quantidade_comercial ?? line.quantidade,
    quantityTax: line.quantidade_tributavel,
  });
  return sanitizeCatalogProductName(built.catalogName) ||
    sanitizeCatalogProductName(line.nome) ||
    "Item";
}

function nameVariantsForMatch(line: NfeXmlLineIdentity): string[] {
  const raw = String(line.nome ?? "").trim();
  const reg = registrationNameFromLine(line);
  const variants = [raw, reg, sanitizeCatalogProductName(raw)];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of variants) {
    const t = String(v ?? "").trim();
    if (!t) continue;
    const k = catalogMatchNameKey(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function pickPreferredProduct<T extends MatchExistingNfeProductCatalogRow>(
  candidates: T[],
  line: NfeXmlLineIdentity,
  preferredIds: Set<string>,
): T | undefined {
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];

  const n8 = normalizeNcm8Digits(line.ncm);
  const preferred = candidates.filter((c) => preferredIds.has(c.id));
  const pool = preferred.length > 0 ? preferred : candidates;

  if (n8) {
    const withNcm = pool.filter((p) => normalizeNcm8Digits(p.ncm) === n8);
    if (withNcm.length === 1) return withNcm[0];
    if (withNcm.length > 1) return withNcm[0];
  }
  return pool[0];
}

function findByCanonicalName<T extends MatchExistingNfeProductCatalogRow>(
  catalog: T[],
  line: NfeXmlLineIdentity,
  preferredIds: Set<string>,
): T | undefined {
  const canons = new Set<string>();
  for (const v of nameVariantsForMatch(line)) {
    const c = canonicalProductName(v);
    if (c.length >= 2) canons.add(c);
  }
  if (canons.size === 0) return undefined;

  const hits = catalog.filter((p) => {
    const pc = String(p.canonical_name ?? "").trim();
    if (pc && canons.has(pc)) return true;
    const fromName = canonicalProductName(p.name);
    return fromName.length >= 2 && canons.has(fromName);
  });
  return pickPreferredProduct(hits, line, preferredIds);
}

function findByCatalogNameKey<T extends MatchExistingNfeProductCatalogRow>(
  catalog: T[],
  line: NfeXmlLineIdentity,
  preferredIds: Set<string>,
): T | undefined {
  const keys = new Set(
    nameVariantsForMatch(line).map((v) => catalogMatchNameKey(v)).filter(
      (k) => k.length >= 2,
    ),
  );
  if (keys.size === 0) return undefined;
  const hits = catalog.filter((p) => keys.has(catalogMatchNameKey(p.name)));
  return pickPreferredProduct(hits, line, preferredIds);
}

function findByMergedAlias<T extends MatchExistingNfeProductCatalogRow>(
  catalog: T[],
  line: NfeXmlLineIdentity,
  preferredIds: Set<string>,
): T | undefined {
  const variants = nameVariantsForMatch(line);
  const hits = catalog.filter((p) => {
    const merged = p.merged_catalog_names;
    if (!merged?.length) return false;
    return variants.some((v) => invoiceLabelMatchesMergedCatalog(v, merged));
  });
  return pickPreferredProduct(hits, line, preferredIds);
}

function findBySkuEqualsCProd<T extends MatchExistingNfeProductCatalogRow>(
  catalog: T[],
  cProd: string | null,
  line: NfeXmlLineIdentity,
  preferredIds: Set<string>,
): T | undefined {
  if (!cProd) return undefined;
  const code = cProd.trim().toLowerCase();
  if (!code) return undefined;
  const hits = catalog.filter((p) => {
    const sku = p.sku != null ? String(p.sku).trim().toLowerCase() : "";
    return sku.length > 0 && sku === code;
  });
  return pickPreferredProduct(hits, line, preferredIds);
}

/**
 * Tenta vincular a linha XML a um produto já cadastrado.
 * Ordem: EAN → cProd+fornecedor → SKU=cProd → histórico fornecedor →
 * NCM+nome → canonical_name → nome catálogo → aliases de merge.
 */
export async function matchExistingProductFromNfeXmlLine(input: {
  supabase?: SupabaseClient;
  companyId?: string;
  supplierId?: string | null;
  line: NfeXmlLineIdentity;
  catalog: MatchExistingNfeProductCatalogRow[];
  supplierHints?: SupplierProductMatchHints | null;
}): Promise<MatchExistingNfeProductResult | null> {
  const catalog = activeCatalog(input.catalog);
  const preferredIds = input.supplierHints?.preferredProductIds ??
    new Set<string>();
  const historyNames = input.supplierHints?.nameKeyToProductId ??
    new Map<string, string>();
  const line = input.line;
  const cProd = normalizeCProd(line.codigo);

  const byEan = findDirectMatchByEan(catalog, line.ean, eanLookupKeys);
  if (byEan) {
    return {
      productId: byEan.id,
      productName: byEan.name,
      criterio: "ean",
    };
  }

  if (
    cProd &&
    input.supplierId &&
    input.supabase &&
    input.companyId
  ) {
    const byCProd = await findProductIdBySupplierCProd(
      input.supabase,
      input.companyId,
      String(input.supplierId),
      cProd,
    );
    if (byCProd) {
      const hit = catalog.find((p) => p.id === byCProd);
      return {
        productId: byCProd,
        productName: hit?.name ?? null,
        criterio: "cprod_fornecedor",
      };
    }
  }

  const bySku = findBySkuEqualsCProd(catalog, cProd, line, preferredIds);
  if (bySku) {
    return {
      productId: bySku.id,
      productName: bySku.name,
      criterio: "sku_igual_cprod",
    };
  }

  for (const v of nameVariantsForMatch(line)) {
    const key = catalogMatchNameKey(v);
    const histId = key.length >= 2 ? historyNames.get(key) : undefined;
    if (histId) {
      const hit = catalog.find((p) => p.id === histId);
      return {
        productId: histId,
        productName: hit?.name ?? null,
        criterio: "historico_fornecedor",
      };
    }
  }

  for (const v of nameVariantsForMatch(line)) {
    const byNcmName = findDirectMatchByNcmAndName(catalog, line.ncm, v);
    if (byNcmName) {
      const preferred = pickPreferredProduct(
        catalog.filter(
          (p) =>
            normalizeNcm8Digits(p.ncm) === normalizeNcm8Digits(line.ncm) &&
            catalogMatchNameKey(p.name) === catalogMatchNameKey(v),
        ),
        line,
        preferredIds,
      ) ?? byNcmName;
      return {
        productId: preferred.id,
        productName: preferred.name,
        criterio: "ncm_e_nome",
      };
    }
  }

  const byCanon = findByCanonicalName(catalog, line, preferredIds);
  if (byCanon) {
    return {
      productId: byCanon.id,
      productName: byCanon.name,
      criterio: "canonical_name",
    };
  }

  const byName = findByCatalogNameKey(catalog, line, preferredIds);
  if (byName) {
    return {
      productId: byName.id,
      productName: byName.name,
      criterio: "nome_catalogo",
    };
  }

  const byMerged = findByMergedAlias(catalog, line, preferredIds);
  if (byMerged) {
    return {
      productId: byMerged.id,
      productName: byMerged.name,
      criterio: "merged_catalog_names",
    };
  }

  return null;
}

export function previewActionForMatchCriterio(
  criterio: MatchExistingNfeProductCriterio,
): 
  | "link_ean"
  | "link_cprod_supplier"
  | "link_sku_cprod"
  | "link_canonical_name"
  | "link_ncm_nome"
  | "link_nome"
  | "link_merged_alias"
  | "link_historico_fornecedor" {
  switch (criterio) {
    case "ean":
      return "link_ean";
    case "cprod_fornecedor":
      return "link_cprod_supplier";
    case "sku_igual_cprod":
      return "link_sku_cprod";
    case "canonical_name":
      return "link_canonical_name";
    case "ncm_e_nome":
      return "link_ncm_nome";
    case "nome_catalogo":
      return "link_nome";
    case "merged_catalog_names":
      return "link_merged_alias";
    case "historico_fornecedor":
      return "link_historico_fornecedor";
  }
}

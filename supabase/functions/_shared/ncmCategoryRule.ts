/**
 * Regras NCM → categoria de produto (Conta do DRE vem da categoria).
 */
import {
  normalizeNcm8Digits,
  productCatalogSemNcm,
} from "./productImport/llmCatalogCandidates.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export type NcmProductRule = {
  productCategoryId: string;
  dreCategoryId: string | null;
  productCategoryName: string | null;
};

export function ncmKeyForCategoryRule(
  ncm: string | null | undefined,
): string | null {
  if (productCatalogSemNcm(ncm)) return null;
  return normalizeNcm8Digits(ncm);
}

/**
 * Conta do DRE da linha: NCM ganha da memória do produto.
 * Não sobrescreve categoria já definida.
 */
export function resolvePurchaseCategoryId(input: {
  existingCategoryId?: string | null;
  productCategoryId?: string | null;
  ncmCategoryId?: string | null;
}): string | null {
  const existing = String(input.existingCategoryId ?? "").trim();
  if (existing) return existing;
  const ncm = String(input.ncmCategoryId ?? "").trim();
  if (ncm) return ncm;
  const product = String(input.productCategoryId ?? "").trim();
  if (product) return product;
  return null;
}

function embeddedProductCategory(row: {
  company_product_categories?:
    | {
        default_dre_category_id?: string | null;
        name?: string | null;
      }
    | Array<{
        default_dre_category_id?: string | null;
        name?: string | null;
      }>
    | null;
}): {
  default_dre_category_id?: string | null;
  name?: string | null;
} | null {
  const embedded = row.company_product_categories;
  if (!embedded) return null;
  return Array.isArray(embedded) ? embedded[0] ?? null : embedded;
}

function rowToRule(row: {
  product_category_id?: string | null;
  company_product_categories?:
    | {
        default_dre_category_id?: string | null;
        name?: string | null;
      }
    | Array<{
        default_dre_category_id?: string | null;
        name?: string | null;
      }>
    | null;
}): NcmProductRule | null {
  const productCategoryId = String(row.product_category_id ?? "").trim();
  if (!productCategoryId) return null;
  const cat = embeddedProductCategory(row);
  const dre = String(cat?.default_dre_category_id ?? "").trim();
  const name = String(cat?.name ?? "").trim();
  return {
    productCategoryId,
    dreCategoryId: dre || null,
    productCategoryName: name || null,
  };
}

export async function fetchCompanyNcmCategoryMap(
  supabase: SupabaseClient,
  companyId: string,
): Promise<Map<string, NcmProductRule>> {
  const map = new Map<string, NcmProductRule>();
  if (!companyId) return map;
  const { data } = await supabase
    .from("company_ncm_category_rules")
    .select("ncm, product_category_id, company_product_categories(default_dre_category_id, name)")
    .eq("company_id", companyId);
  for (const row of data ?? []) {
    const ncm = ncmKeyForCategoryRule(
      (row as { ncm?: string | null }).ncm,
    );
    const rule = rowToRule(
      row as {
        product_category_id?: string | null;
        company_product_categories?: {
          default_dre_category_id?: string | null;
          name?: string | null;
        } | null;
      },
    );
    if (ncm && rule) map.set(ncm, rule);
  }
  return map;
}

export async function lookupNcmProductRule(
  supabase: SupabaseClient,
  companyId: string,
  ncm: string | null | undefined,
): Promise<NcmProductRule | null> {
  const key = ncmKeyForCategoryRule(ncm);
  if (!key || !companyId) return null;
  const { data } = await supabase
    .from("company_ncm_category_rules")
    .select("product_category_id, company_product_categories(default_dre_category_id, name)")
    .eq("company_id", companyId)
    .eq("ncm", key)
    .maybeSingle();
  if (!data) return null;
  return rowToRule(
    data as {
      product_category_id?: string | null;
      company_product_categories?: {
        default_dre_category_id?: string | null;
        name?: string | null;
      } | null;
    },
  );
}

export function applyNcmProductRuleToNewProduct(
  row: Record<string, unknown>,
  rule: NcmProductRule | null,
): void {
  if (!rule) return;
  if (!String(row.product_category_id ?? "").trim()) {
    row.product_category_id = rule.productCategoryId;
  }
  if (
    !String(row.default_expense_category_id ?? "").trim() &&
    rule.dreCategoryId
  ) {
    row.default_expense_category_id = rule.dreCategoryId;
  }
  if (row.composes_cmv == null) {
    const name = rule.productCategoryName ?? "";
    row.composes_cmv = !["Gás", "Coleta de óleo", "Material de Limpeza"].includes(
      name,
    );
  }
}

export async function lookupNcmCategoryId(
  supabase: SupabaseClient,
  companyId: string,
  ncm: string | null | undefined,
): Promise<string | null> {
  const rule = await lookupNcmProductRule(supabase, companyId, ncm);
  return rule?.dreCategoryId ?? null;
}

export async function ensureProductCatalogTag(
  supabase: SupabaseClient,
  companyId: string,
  productId: string,
  productCategoryId: string,
): Promise<void> {
  const { data } = await supabase
    .from("product_category_assignments")
    .select("category_id")
    .eq("product_id", productId)
    .limit(1);
  if ((data ?? []).length > 0) return;
  await supabase.from("product_category_assignments").insert({
    company_id: companyId,
    product_id: productId,
    category_id: productCategoryId,
  });
}

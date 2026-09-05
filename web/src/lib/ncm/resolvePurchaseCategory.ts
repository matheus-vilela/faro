/**
 * Conta do DRE da linha de NF: regra NCM (via categoria de produto) ganha da
 * memória do produto. Não sobrescreve categoria já definida na linha.
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

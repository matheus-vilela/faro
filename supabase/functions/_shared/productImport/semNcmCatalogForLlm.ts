/**
 * Produtos sem NCM no cadastro entram na lista enviada à IA para vínculo por nome
 * (cadastro incompleto ou abreviado vs descrição completa na NF-e).
 */

export const DEFAULT_SEM_NCM_LLM_CATALOG_CAP = 200;

function ncmDigits(ncm: string | null | undefined): string {
  return String(ncm ?? "").replace(/\D/g, "");
}

/** Catálogo sem NCM utilizável (vazio ou só zeros). */
export function productCatalogSemNcm(ncm: string | null | undefined): boolean {
  const d = ncmDigits(ncm);
  return d.length < 1 || /^0+$/.test(d);
}

export type ProductRowSemNcmCheck = { id: string; ncm?: string | null };

export function filterActiveCatalogSemNcm<T extends ProductRowSemNcmCheck>(
  catalog: T[],
): T[] {
  return catalog.filter((p) => productCatalogSemNcm(p.ncm));
}

export function semNcmLlmCatalogCapFromEnv(): number {
  try {
    const n = Number.parseInt(
      String(
        typeof Deno !== "undefined"
          ? Deno.env.get("IMPORT_NFE_SEM_NCM_LLM_CATALOG_CAP") ?? "200"
          : "200",
      ),
      10,
    );
    return Number.isFinite(n) && n >= 20 && n <= 500 ? Math.floor(n) : DEFAULT_SEM_NCM_LLM_CATALOG_CAP;
  } catch {
    return DEFAULT_SEM_NCM_LLM_CATALOG_CAP;
  }
}

/** Inclui produtos sem NCM na lista de candidatos da IA (não duplica ids). */
export function appendSemNcmProductsForLlmReview<
  T extends { id: string; ncm?: string | null },
>(
  catalog: T[],
  alreadyIncludedIds: Set<string>,
  maxAdd = semNcmLlmCatalogCapFromEnv(),
): T[] {
  const out: T[] = [];
  for (const p of catalog) {
    if (!productCatalogSemNcm(p.ncm)) continue;
    if (alreadyIncludedIds.has(p.id)) continue;
    out.push(p);
    alreadyIncludedIds.add(p.id);
    if (out.length >= maxAdd) break;
  }
  return out;
}

import { canonicalProductName, normalizeInvoiceProductLabel } from "./canonicalName";
import { scoreNameMatch } from "./matchingScore";

/** Rótulos alternativos gravados ao unificar produtos duplicados. */
export function mergedCatalogNameLabels(
  merged: string[] | null | undefined,
): string[] {
  if (!merged?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of merged) {
    const t = String(raw ?? "").trim();
    if (!t) continue;
    const key = normalizeInvoiceProductLabel(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function invoiceLabelMatchesMergedCatalog(
  invoiceLine: string | null | undefined,
  merged: string[] | null | undefined,
): boolean {
  const inv = normalizeInvoiceProductLabel(String(invoiceLine ?? ""));
  const invCanon = canonicalProductName(invoiceLine);
  if (!inv && !invCanon) return false;
  for (const alias of mergedCatalogNameLabels(merged)) {
    const a = normalizeInvoiceProductLabel(alias);
    const ac = canonicalProductName(alias);
    if ((inv && a && inv === a) || (invCanon && ac && invCanon === ac)) return true;
  }
  return false;
}

/** Pontuação de nome considerando aliases de produtos unificados. */
export function scoreNameMatchIncludingMergedAliases(
  invoiceLine: string | null | undefined,
  catalogName: string | null | undefined,
  mergedCatalogNames?: string[] | null,
): number {
  let best = scoreNameMatch(invoiceLine, catalogName);
  for (const alias of mergedCatalogNameLabels(mergedCatalogNames)) {
    best = Math.max(best, scoreNameMatch(invoiceLine, alias));
  }
  return best;
}

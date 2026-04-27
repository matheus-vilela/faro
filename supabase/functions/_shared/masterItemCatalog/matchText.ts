import { stripDiacriticsLower } from "../productImport/canonicalName.ts";

export function masterCatalogNorm(s: string): string {
  return stripDiacriticsLower(s).replace(/\s+/g, " ");
}

/**
 * Se o termo for curto, exige match por token; senão substring.
 */
export function masterCatalogAliasMatchesText(blob: string, aliasNorm: string): boolean {
  if (!aliasNorm) return false;
  if (aliasNorm.length >= 4) return blob.includes(aliasNorm);
  const tokens = blob.split(/[^a-z0-9]+/).filter((t) => t.length > 0);
  if (aliasNorm.length <= 3) {
    return tokens.some((t) => t === aliasNorm) || blob.includes(aliasNorm);
  }
  return blob.includes(aliasNorm);
}

export function nameOrAliasMatchesBlob(
  blob: string,
  customName: string | null | undefined,
  customAlias: string | null | undefined,
): boolean {
  for (const raw of [customName, customAlias]) {
    const t = (raw ?? "").trim();
    if (!t) continue;
    const n = masterCatalogNorm(t);
    if (masterCatalogAliasMatchesText(blob, n)) return true;
  }
  return false;
}

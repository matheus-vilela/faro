/**
 * Helpers determinísticos de catálogo (EAN, nome, NCM) para vínculo sem IA.
 */
import { beverageSkuVolumeConflict } from "./beverageSkuIdentity.ts";
import {
  canonicalProductName,
  sanitizeCatalogProductName,
  stripDiacriticsLower,
} from "./canonicalName.ts";

/** NCM com 8 dígitos (zeros à esquerda). */
export function normalizeNcm8Digits(ncm: string | null | undefined): string | null {
  const d = String(ncm ?? "").replace(/\D/g, "");
  if (d.length < 1) return null;
  if (d.length < 8) return d.padStart(8, "0");
  return d.slice(0, 8);
}

export function productCatalogSemNcm(ncm: string | null | undefined): boolean {
  const d = String(ncm ?? "").replace(/\D/g, "");
  return d.length < 1 || /^0+$/.test(d);
}

export function catalogProductNameKey(name: string): string {
  return sanitizeCatalogProductName(name).toLowerCase();
}

/**
 * Chave para comparar nomes normalizados: sem acento, tokens de ruído
 * e plural simples (ex.: "ÁGUA COM GÁS" ↔ "AGUA COM GAS" → "agua gas").
 */
export function catalogMatchNameKey(name: string): string {
  const canon = canonicalProductName(name);
  if (canon.length >= 2) return canon;
  return stripDiacriticsLower(sanitizeCatalogProductName(name));
}

/**
 * Produto já cadastrado com o mesmo nome de catálogo (ignora NCM).
 */
export function findCatalogProductByNameKey<T extends { id: string; name: string }>(
  catalog: T[],
  invoiceOrCatalogName: string,
): T | undefined {
  const lineKey = catalogMatchNameKey(invoiceOrCatalogName);
  if (!lineKey || lineKey.length < 2) return undefined;
  const matches = catalog.filter((p) => catalogMatchNameKey(p.name) === lineKey);
  if (matches.length === 0) return undefined;
  const strict = stripDiacriticsLower(
    sanitizeCatalogProductName(invoiceOrCatalogName),
  );
  const strictHits = matches.filter(
    (p) => stripDiacriticsLower(sanitizeCatalogProductName(p.name)) === strict,
  );
  const pick = strictHits[0] ?? (matches.length === 1 ? matches[0] : matches[0]);
  if (!pick) return undefined;
  if (beverageSkuVolumeConflict(invoiceOrCatalogName, pick.name)) return undefined;
  return pick;
}

/** Produto já cadastrado com o mesmo nome normalizado (dedupe). */
export function findCatalogProductByNormalizedName<T extends { id: string; name: string }>(
  catalog: T[],
  normalizedName: string,
  invoiceLineName?: string | null,
): T | undefined {
  const key = catalogMatchNameKey(normalizedName);
  if (!key || key.length < 2) return undefined;
  const matches = catalog.filter((p) => catalogMatchNameKey(p.name) === key);
  if (matches.length === 0) return undefined;
  const strict = stripDiacriticsLower(sanitizeCatalogProductName(normalizedName));
  const strictHits = matches.filter(
    (p) => stripDiacriticsLower(sanitizeCatalogProductName(p.name)) === strict,
  );
  const pick = strictHits[0] ?? (matches.length === 1 ? matches[0] : matches[0]);
  if (!pick) return undefined;
  const invoiceRef = String(invoiceLineName ?? normalizedName).trim();
  if (beverageSkuVolumeConflict(invoiceRef, pick.name)) return undefined;
  return pick;
}

/** Dígitos do GTIN e variantes comuns para match direto por EAN. */
export function eanLookupKeys(raw: string | null | undefined): string[] {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return [];
  const keys = new Set<string>([d]);
  if (d.length === 12) keys.add(`0${d}`);
  if (d.length === 13 && d.startsWith("0")) keys.add(d.slice(1));
  if (d.length === 8) keys.add(d.padStart(14, "0"));
  if (d.length === 14 && d.startsWith("0")) keys.add(d.replace(/^0+/, "") || d);
  return [...keys];
}

export function findDirectMatchByEan<T extends { ean?: string | null; barcode?: string | null }>(
  catalog: T[],
  invoiceEan: string | null | undefined,
  eanKeys: (raw: string | null | undefined) => string[],
): T | undefined {
  const keys = eanKeys(invoiceEan);
  if (!keys.length) return undefined;
  return catalog.find((p) => {
    const pe = String(p.ean ?? "").replace(/\D/g, "");
    const pb = String(p.barcode ?? "").replace(/\D/g, "");
    return (pe.length > 0 && keys.includes(pe)) ||
      (pb.length > 0 && keys.includes(pb));
  });
}

/** Match direto: mesmo NCM (8 dígitos) e nome sanitizado idêntico. */
export function findDirectMatchByNcmAndName<T extends { name: string; ncm?: string | null }>(
  catalog: T[],
  invoiceNcm: string | null | undefined,
  invoiceName: string,
): T | undefined {
  const n8 = normalizeNcm8Digits(invoiceNcm);
  if (!n8) return undefined;
  const lineKey = catalogMatchNameKey(invoiceName);
  if (!lineKey) return undefined;
  return catalog.find(
    (p) =>
      normalizeNcm8Digits(p.ncm) === n8 && catalogMatchNameKey(p.name) === lineKey,
  );
}

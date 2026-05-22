/**
 * Monta a lista de produtos enviada à IA quando não há match direto (EAN ou NCM+nome).
 */
import { beverageSkuVolumeConflict } from "./beverageSkuIdentity.ts";
import {
  canonicalProductName,
  sanitizeCatalogProductName,
  stripDiacriticsLower,
} from "./canonicalName.ts";
import type { NfeRagArbiterCandidate } from "./productMatchLlmAssist.ts";

export const DEFAULT_LLM_CATALOG_CAP = 2500;

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
 * Chave para comparar nome normalizado da IA com cadastro: sem acento, tokens de ruído
 * e plural simples (ex.: "ÁGUA COM GÁS" ↔ "AGUA COM GAS" → "agua gas").
 */
export function catalogMatchNameKey(name: string): string {
  const canon = canonicalProductName(name);
  if (canon.length >= 2) return canon;
  return stripDiacriticsLower(sanitizeCatalogProductName(name));
}

/**
 * Produto já cadastrado com o mesmo nome de catálogo (ignora NCM).
 * Evita duplicar "AGUA SANITARIA" quando a nota traz NCM diferente do cadastro.
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

/** Produto já cadastrado com o mesmo nome normalizado (pós-IA ou dedupe). */
export function findCatalogProductByNormalizedName<T extends { id: string; name: string }>(
  catalog: T[],
  normalizedName: string,
  /** Rótulo bruto da NF-e — usado para bloquear vínculo entre bebidas de volumes diferentes. */
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

export function findCandidateProductIdByNormalizedName(
  candidates: { product_id: string; name: string }[],
  normalizedName: string,
  invoiceLineName?: string | null,
): string | undefined {
  const hit = findCatalogProductByNormalizedName(
    candidates.map((c) => ({ id: c.product_id, name: c.name })),
    normalizedName,
    invoiceLineName,
  );
  return hit?.id;
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

export function llmCatalogCapFromEnv(): number {
  try {
    const n = Number.parseInt(
      String(
        typeof Deno !== "undefined"
          ? Deno.env.get("IMPORT_NFE_LLM_CATALOG_CAP") ?? String(DEFAULT_LLM_CATALOG_CAP)
          : String(DEFAULT_LLM_CATALOG_CAP),
      ),
      10,
    );
    return Number.isFinite(n) && n >= 50 && n <= 8000 ? Math.floor(n) : DEFAULT_LLM_CATALOG_CAP;
  } catch {
    return DEFAULT_LLM_CATALOG_CAP;
  }
}

export type CatalogRowForLlm = {
  id: string;
  name: string;
  unit?: string | null;
  ncm?: string | null;
  ean?: string | null;
  barcode?: string | null;
};

export function findDirectMatchByEan<T extends { ean?: string | null; barcode?: string | null }>(
  catalog: T[],
  invoiceEan: string | null | undefined,
  eanKeys: (raw: string | null | undefined) => string[],
): T | undefined {
  const keys = eanKeys(invoiceEan);
  if (!keys.length) return undefined;
  return catalog.find((p) => {
    const pe = String(p.ean ?? p.barcode ?? "").replace(/\D/g, "");
    return pe.length > 0 && keys.includes(pe);
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

/**
 * Lista para a IA:
 * - Linha **sem** NCM na nota → catálogo inteiro (ativo).
 * - Linha **com** NCM → todos com o mesmo NCM + todos sem NCM no cadastro.
 */
export function buildLlmCatalogForInvoiceLine<T extends { id: string; ncm?: string | null }>(
  activeCatalog: T[],
  invoiceNcm: string | null | undefined,
): T[] {
  const n8 = normalizeNcm8Digits(invoiceNcm);
  const seen = new Set<string>();
  const out: T[] = [];
  const add = (p: T) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    out.push(p);
  };

  if (!n8) {
    for (const p of activeCatalog) add(p);
  } else {
    for (const p of activeCatalog) {
      if (normalizeNcm8Digits(p.ncm) === n8) add(p);
    }
    for (const p of activeCatalog) {
      if (productCatalogSemNcm(p.ncm)) add(p);
    }
  }

  const cap = llmCatalogCapFromEnv();
  if (out.length > cap) {
    console.warn(
      "[llmCatalogCandidates] catálogo truncado para IA",
      JSON.stringify({ total: out.length, cap, invoice_ncm: n8 }),
    );
    return out.slice(0, cap);
  }
  return out;
}

export function catalogToLlmArbiterCandidates(
  rows: CatalogRowForLlm[],
): NfeRagArbiterCandidate[] {
  return rows.map((c, idx) => ({
    rank: idx + 1,
    product_id: c.id,
    name: c.name,
    catalog_unit: c.unit ?? null,
    ncm: c.ncm ?? null,
    barcode_digits: (() => {
      const d = String(c.ean ?? c.barcode ?? "").replace(/\D/g, "");
      return d.length >= 4 ? d : null;
    })(),
    similarity_0_100: 0,
    match_detail: "catálogo completo para vínculo por nome (IA)",
  }));
}

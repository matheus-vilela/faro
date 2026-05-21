/**
 * Resolução de produto na importação EPOC/CSV — alinhada ao motor de NF-e:
 * nome de cadastro (sanitize), deduplicação por canonical_name e cache por linha.
 */
import {
  canonicalProductName,
  sanitizeCatalogProductName,
} from "./productImport/canonicalName.ts";

export type EpocCatalogProduct = {
  id: string;
  name: string;
  unit?: string | null;
  canonical_name?: string | null;
};

function normalizeCatalogName(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Chave estável para cache/metadata (canonical preferido). */
export function epocProductLineKey(raw: string): string {
  const catalogName = sanitizeCatalogProductName(raw);
  const cn = canonicalProductName(catalogName || raw);
  if (cn) return cn;
  return normalizeCatalogName(raw);
}

export function epocCatalogDisplayName(raw: string): string {
  return sanitizeCatalogProductName(raw) || sanitizeCatalogProductName("Produto");
}

export function buildCanonicalProductIndex(
  catalog: EpocCatalogProduct[],
): Map<string, string | null> {
  const index = new Map<string, string | null>();
  for (const p of catalog) {
    const cn =
      String(p.canonical_name ?? "").trim() ||
      canonicalProductName(p.name) ||
      "";
    if (!cn) continue;
    const prev = index.get(cn);
    if (prev === undefined) index.set(cn, p.id);
    else if (prev !== p.id) index.set(cn, null);
  }
  return index;
}

function catalogNameMatchCount(
  displayName: string,
  catalog: EpocCatalogProduct[],
): number {
  const norm = normalizeCatalogName(displayName);
  if (!norm) return 0;
  return catalog.filter((p) => normalizeCatalogName(p.name) === norm).length;
}

function resolveByNormalizedName(
  displayName: string,
  catalog: EpocCatalogProduct[],
  cache: Map<string, string | null>,
): string | null {
  const norm = normalizeCatalogName(displayName);
  if (!norm) return null;
  if (cache.has(norm)) return cache.get(norm) ?? null;
  const matches = catalog.filter((p) => normalizeCatalogName(p.name) === norm);
  if (matches.length === 1) {
    cache.set(norm, matches[0]!.id);
    return matches[0]!.id;
  }
  if (matches.length > 1) {
    cache.set(norm, null);
    return null;
  }
  cache.set(norm, null);
  return null;
}

export type ResolveEpocProductResult = {
  productId: string | null;
  lineKey: string;
  catalogName: string;
  canonicalName: string;
  ambiguous: boolean;
  ambiguousReason?: "canonical" | "display_name";
};

export function resolveEpocProductId(
  rawName: string,
  catalog: EpocCatalogProduct[],
  cache: Map<string, string | null>,
  canonicalIndex: Map<string, string | null>,
): ResolveEpocProductResult {
  const catalogName = epocCatalogDisplayName(rawName);
  const lineKey = epocProductLineKey(rawName);
  const canonicalName =
    canonicalProductName(catalogName || rawName) || lineKey;

  if (cache.has(lineKey)) {
    const cached = cache.get(lineKey) ?? null;
    return {
      productId: cached,
      lineKey,
      catalogName,
      canonicalName,
      ambiguous: false,
    };
  }

  const canonId = canonicalIndex.get(canonicalName);
  if (canonId === null) {
    cache.set(lineKey, null);
    return {
      productId: null,
      lineKey,
      catalogName,
      canonicalName,
      ambiguous: true,
      ambiguousReason: "canonical",
    };
  }
  if (typeof canonId === "string" && canonId) {
    cache.set(lineKey, canonId);
    return {
      productId: canonId,
      lineKey,
      catalogName,
      canonicalName,
      ambiguous: false,
    };
  }

  let id = resolveByNormalizedName(rawName, catalog, cache);
  if (id) {
    cache.set(lineKey, id);
    return {
      productId: id,
      lineKey,
      catalogName,
      canonicalName,
      ambiguous: false,
    };
  }
  if (normalizeCatalogName(catalogName) !== normalizeCatalogName(rawName)) {
    id = resolveByNormalizedName(catalogName, catalog, cache);
    if (id) {
      cache.set(lineKey, id);
      return {
        productId: id,
        lineKey,
        catalogName,
        canonicalName,
        ambiguous: false,
      };
    }
  }

  const ambRaw = catalogNameMatchCount(rawName, catalog);
  const ambCatalog =
    normalizeCatalogName(catalogName) !== normalizeCatalogName(rawName)
      ? catalogNameMatchCount(catalogName, catalog)
      : 0;
  if (ambRaw > 1 || ambCatalog > 1) {
    cache.set(lineKey, null);
    return {
      productId: null,
      lineKey,
      catalogName,
      canonicalName,
      ambiguous: true,
      ambiguousReason: "display_name",
    };
  }

  cache.set(lineKey, null);
  return {
    productId: null,
    lineKey,
    catalogName,
    canonicalName,
    ambiguous: false,
  };
}

export function registerResolvedEpocProduct(
  catalog: EpocCatalogProduct[],
  canonicalIndex: Map<string, string | null>,
  cache: Map<string, string | null>,
  product: EpocCatalogProduct,
  lineKey: string,
  catalogName: string,
): void {
  catalog.push(product);
  const cn =
    String(product.canonical_name ?? "").trim() ||
    canonicalProductName(catalogName || product.name) ||
    "";
  if (cn) {
    const prev = canonicalIndex.get(cn);
    if (prev === undefined || prev === product.id) {
      canonicalIndex.set(cn, product.id);
    } else {
      canonicalIndex.set(cn, null);
    }
  }
  cache.set(lineKey, product.id);
  const normCatalog = normalizeCatalogName(catalogName);
  if (normCatalog) cache.set(normCatalog, product.id);
  cache.set(normalizeCatalogName(product.name), product.id);
}

// deno-lint-ignore no-explicit-any
export async function lookupActiveProductIdByCanonical(
  admin: any,
  companyId: string,
  catalogName: string,
  rawName: string,
): Promise<string | null> {
  const cn = canonicalProductName(catalogName || rawName);
  if (!cn) return null;
  const { data, error } = await admin
    .from("products")
    .select("id")
    .eq("company_id", companyId)
    .eq("canonical_name", cn)
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    console.error(
      "[epocCsvProductResolution] canonical lookup:",
      error.message,
    );
    return null;
  }
  return data?.id ? String(data.id) : null;
}

export function productIdCacheToMetadata(
  cache: Map<string, string | null>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of cache.entries()) {
    if (typeof v === "string" && v) out[k] = v;
  }
  return out;
}

export function loadProductIdCacheFromMetadata(
  meta: Record<string, unknown> | undefined,
): Map<string, string | null> {
  const cache = new Map<string, string | null>();
  const raw = meta?.epoc_product_id_by_line_key;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return cache;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v) cache.set(k, v);
  }
  return cache;
}

// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

/** Reconsulta o banco e atualiza catálogo/índice/cache antes de criar (evita duplicata entre chunks/workers). */
export async function fetchActiveProductRowByCanonical(
  admin: SupabaseAdmin,
  companyId: string,
  catalogName: string,
  rawName: string,
): Promise<EpocCatalogProduct | null> {
  const cn = canonicalProductName(catalogName || rawName);
  if (!cn) return null;
  const { data, error } = await admin
    .from("products")
    .select("id, name, unit, canonical_name")
    .eq("company_id", companyId)
    .eq("canonical_name", cn)
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    console.error(
      "[epocCsvProductResolution] fetch by canonical:",
      error.message,
    );
    return null;
  }
  if (!data?.id) return null;
  return {
    id: String(data.id),
    name: String(data.name ?? catalogName),
    unit: (data.unit as string | null) ?? null,
    canonical_name: (data.canonical_name as string | null) ?? cn,
  };
}

export type EnsureEpocProductParams = {
  rawName: string;
  catalogName: string;
  lineKey: string;
  canonicalName: string;
  inferredUnit: string;
  autoStock: string;
};

export type EnsureEpocProductResult = {
  productId: string | null;
  created: boolean;
  ambiguous: boolean;
  ambiguousReason?: ResolveEpocProductResult["ambiguousReason"];
};

/**
 * Garante produto único por canonical/lineKey: resolve em memória, serializa criações
 * concorrentes na mesma invocação e reconsulta o banco imediatamente antes do INSERT.
 */
export class EpocProductEnsureCoordinator {
  private readonly pending = new Map<string, Promise<EnsureEpocProductResult>>();

  constructor(
    private readonly admin: SupabaseAdmin,
    private readonly companyId: string,
    private readonly catalog: EpocCatalogProduct[],
    private readonly canonicalIndex: Map<string, string | null>,
    private readonly cache: Map<string, string | null>,
  ) {}

  async ensure(params: EnsureEpocProductParams): Promise<EnsureEpocProductResult> {
    const lockKey = params.canonicalName || params.lineKey;
    const first = resolveEpocProductId(
      params.rawName,
      this.catalog,
      this.cache,
      this.canonicalIndex,
    );
    if (first.ambiguous) {
      return {
        productId: null,
        created: false,
        ambiguous: true,
        ambiguousReason: first.ambiguousReason,
      };
    }
    if (first.productId) {
      return {
        productId: first.productId,
        created: false,
        ambiguous: false,
      };
    }

    let inflight = this.pending.get(lockKey);
    if (!inflight) {
      inflight = this.ensureOnce(params);
      this.pending.set(lockKey, inflight);
      void inflight.finally(() => {
        if (this.pending.get(lockKey) === inflight) {
          this.pending.delete(lockKey);
        }
      });
    }
    return inflight;
  }

  private async ensureOnce(
    params: EnsureEpocProductParams,
  ): Promise<EnsureEpocProductResult> {
    const fromDb = await fetchActiveProductRowByCanonical(
      this.admin,
      this.companyId,
      params.catalogName,
      params.rawName,
    );
    if (fromDb) {
      registerResolvedEpocProduct(
        this.catalog,
        this.canonicalIndex,
        this.cache,
        fromDb,
        params.lineKey,
        params.catalogName,
      );
      return {
        productId: fromDb.id,
        created: false,
        ambiguous: false,
      };
    }

    const again = resolveEpocProductId(
      params.rawName,
      this.catalog,
      this.cache,
      this.canonicalIndex,
    );
    if (again.ambiguous) {
      return {
        productId: null,
        created: false,
        ambiguous: true,
        ambiguousReason: again.ambiguousReason,
      };
    }
    if (again.productId) {
      return {
        productId: again.productId,
        created: false,
        ambiguous: false,
      };
    }

    const canonicalForInsert =
      params.canonicalName ||
      canonicalProductName(params.catalogName || params.rawName) ||
      null;

    const { data: createdProduct, error: createErr } = await this.admin
      .from("products")
      .insert({
        company_id: this.companyId,
        name: params.catalogName,
        canonical_name: canonicalForInsert,
        unit: params.inferredUnit,
        min_quantity: 0,
        current_quantity: 0,
        is_active: true,
        stock_control_type: params.autoStock,
      })
      .select("id, name, unit, canonical_name")
      .single();

    let createdId = createdProduct?.id ? String(createdProduct.id) : null;
    if (createErr?.code === "23505" && canonicalForInsert) {
      const dup = await fetchActiveProductRowByCanonical(
        this.admin,
        this.companyId,
        params.catalogName,
        params.rawName,
      );
      if (dup) createdId = dup.id;
    }

    if (!createdId) {
      return {
        productId: null,
        created: false,
        ambiguous: false,
      };
    }

    const row: EpocCatalogProduct = {
      id: createdId,
      name: (createdProduct?.name as string) ?? params.catalogName,
      unit: (createdProduct?.unit as string | null) ?? params.inferredUnit,
      canonical_name:
        (createdProduct?.canonical_name as string | null) ?? canonicalForInsert,
    };
    registerResolvedEpocProduct(
      this.catalog,
      this.canonicalIndex,
      this.cache,
      row,
      params.lineKey,
      params.catalogName,
    );

    const afterInsert = await fetchActiveProductRowByCanonical(
      this.admin,
      this.companyId,
      params.catalogName,
      params.rawName,
    );
    if (afterInsert && afterInsert.id !== createdId) {
      registerResolvedEpocProduct(
        this.catalog,
        this.canonicalIndex,
        this.cache,
        afterInsert,
        params.lineKey,
        params.catalogName,
      );
      return {
        productId: afterInsert.id,
        created: false,
        ambiguous: false,
      };
    }

    return {
      productId: createdId,
      created: true,
      ambiguous: false,
    };
  }
}

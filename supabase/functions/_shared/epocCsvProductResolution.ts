/**
 * Resolução de produto na importação EPOC/CSV:
 * match exato por nome (produtos e fichas ativos), batch OpenAI para não encontrados.
 */
import {
  batchResolveEpocUnmatchedWithOpenAi,
  type EpocOpenAiCreateHint,
  type EpocOpenAiMatchAssignment,
  type EpocRecipeCatalogEntry,
} from "./epocCsvProductMatchOpenAi.ts";
import { appendProductUnitConversionOnProduct } from "./productUnitConversionsOnProduct.ts";
import {
  canonicalProductName,
  sanitizeCatalogProductName,
} from "./productImport/canonicalName.ts";
import { invoiceLabelMatchesMergedCatalog } from "./productImport/mergedCatalogMatch.ts";

/** Score mínimo (0–100) para match fuzzy legado (não usado no fluxo EPOC). */
export const EPOC_FUZZY_MATCH_MIN_SCORE = 82;
export const EPOC_FUZZY_MATCH_MIN_GAP = 8;

export type EpocCatalogProduct = {
  id: string;
  name: string;
  unit?: string | null;
  canonical_name?: string | null;
};

export function normalizeCatalogName(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Agrupa linhas do CSV com o mesmo nome (após normalizar acentos/caixa). */
export function epocExactNameKey(raw: string): string {
  return normalizeCatalogName(raw);
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

/**
 * Match por tokens: linha EPOC "AGUA COM GAS" ⊆ cadastro "AGUA MINERAL CRYSTAL COM GAS".
 * Ignora tokens de ruído (com, de, …) via catalogMatchNameKey.
 */
export function scoreEpocProductNameMatch(
  csvRaw: string,
  productName: string,
): number {
  const lineKey = catalogMatchNameKey(csvRaw);
  const prodKey = catalogMatchNameKey(productName);
  if (!lineKey || lineKey.length < 2) return 0;
  if (lineKey === prodKey) return 100;

  const lineTokens = lineKey.split(" ").filter((t) => t.length >= 2);
  if (lineTokens.length === 0) return 0;
  const prodTokens = new Set(prodKey.split(" ").filter((t) => t.length >= 2));

  let hit = 0;
  for (const t of lineTokens) {
    if (prodTokens.has(t)) hit += 1;
  }
  const coverage = hit / lineTokens.length;
  if (coverage < 1) return Math.round(coverage * 70);

  const extra = prodTokens.size - hit;
  if (extra <= 2) return 95;
  if (extra <= 4) return 88;
  return 82;
}

export function findEpocFuzzyCatalogMatch(
  catalog: EpocCatalogProduct[],
  rawName: string,
  minScore = EPOC_FUZZY_MATCH_MIN_SCORE,
): EpocCatalogProduct | null {
  const scored: { p: EpocCatalogProduct; score: number }[] = [];
  for (const p of catalog) {
    const s = scoreEpocProductNameMatch(rawName, p.name);
    if (s >= minScore) scored.push({ p, score: s });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0]!;
  if (scored.length >= 2 && top.score - scored[1]!.score < EPOC_FUZZY_MATCH_MIN_GAP) {
    return null;
  }
  return top.p;
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

function findExactActiveProductsByName(
  catalog: EpocCatalogProduct[],
  rawName: string,
): EpocCatalogProduct[] {
  const norm = epocExactNameKey(rawName);
  if (!norm) return [];
  return catalog.filter((p) => epocExactNameKey(p.name) === norm);
}

function findExactActiveRecipeByName(
  recipes: EpocRecipeCatalogEntry[],
  rawName: string,
): EpocRecipeCatalogEntry | null {
  const norm = epocExactNameKey(rawName);
  if (!norm) return null;
  const hits = recipes.filter((r) => epocExactNameKey(r.name) === norm);
  if (hits.length !== 1) return null;
  return hits[0]!;
}

/**
 * Match estrito: mesmo nome (normalizado) em produto ativo ou ficha técnica ativa.
 * Não usa fuzzy nem canonical_name.
 */
export function resolveEpocProductId(
  rawName: string,
  catalog: EpocCatalogProduct[],
  cache: Map<string, string | null>,
  _canonicalIndex: Map<string, string | null>,
  recipes: EpocRecipeCatalogEntry[] = [],
): ResolveEpocProductResult {
  const catalogName = epocCatalogDisplayName(rawName);
  const lineKey = epocProductLineKey(rawName);
  const exactKey = epocExactNameKey(rawName);
  const canonicalName =
    canonicalProductName(catalogName || rawName) || lineKey;

  const cachedExact = cache.get(exactKey);
  if (cache.has(exactKey)) {
    return {
      productId: cachedExact,
      lineKey,
      catalogName,
      canonicalName,
      ambiguous: false,
    };
  }

  const productHits = findExactActiveProductsByName(catalog, rawName);
  if (productHits.length > 1) {
    cache.set(exactKey, null);
    return {
      productId: null,
      lineKey,
      catalogName,
      canonicalName,
      ambiguous: true,
      ambiguousReason: "display_name",
    };
  }
  if (productHits.length === 1) {
    const id = productHits[0]!.id;
    cache.set(exactKey, id);
    return {
      productId: id,
      lineKey,
      catalogName,
      canonicalName,
      ambiguous: false,
    };
  }

  const recipeHit = findExactActiveRecipeByName(recipes, rawName);
  if (recipeHit?.output_product_id) {
    cache.set(exactKey, recipeHit.output_product_id);
    return {
      productId: recipeHit.output_product_id,
      lineKey,
      catalogName,
      canonicalName,
      ambiguous: false,
    };
  }

  cache.set(exactKey, null);
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
  cache.set(epocExactNameKey(product.name), product.id);
  if (catalogName) cache.set(epocExactNameKey(catalogName), product.id);
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
  if (data?.id) return String(data.id);

  const { data: mergedRows, error: mergedErr } = await admin
    .from("products")
    .select("id, merged_catalog_names")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .not("merged_catalog_names", "eq", "{}");

  if (mergedErr) {
    console.error(
      "[epocCsvProductResolution] merged catalog lookup:",
      mergedErr.message,
    );
    return null;
  }

  const label = catalogName || rawName;
  for (const row of mergedRows ?? []) {
    if (
      invoiceLabelMatchesMergedCatalog(
        label,
        row.merged_catalog_names as string[] | null,
      )
    ) {
      return String(row.id);
    }
  }
  return null;
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
  const rawLine = meta?.epoc_product_id_by_line_key;
  if (rawLine && typeof rawLine === "object" && !Array.isArray(rawLine)) {
    for (const [k, v] of Object.entries(rawLine as Record<string, unknown>)) {
      if (typeof v === "string" && v) cache.set(k, v);
    }
  }
  const rawExact = meta?.epoc_product_id_by_exact_name;
  if (rawExact && typeof rawExact === "object" && !Array.isArray(rawExact)) {
    for (const [k, v] of Object.entries(rawExact as Record<string, unknown>)) {
      if (typeof v === "string" && v) cache.set(k, v);
    }
  }
  return cache;
}

export function productIdCacheExactNameToMetadata(
  cache: Map<string, string | null>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of cache.entries()) {
    if (typeof v === "string" && v && k === epocExactNameKey(k)) {
      out[k] = v;
    }
  }
  return out;
}

export type StoredEpocOpenAiPlan = {
  action: string;
  product_id?: string | null;
  recipe_id?: string | null;
  create?: EpocOpenAiCreateHint | null;
  instructions?: string | null;
};

export function loadEpocOpenAiPlanFromMetadata(
  meta: Record<string, unknown> | undefined,
): Map<string, StoredEpocOpenAiPlan> {
  const out = new Map<string, StoredEpocOpenAiPlan>();
  const raw = meta?.epoc_openai_plan_by_exact_name;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.set(k, v as StoredEpocOpenAiPlan);
    }
  }
  return out;
}

export type RunEpocProductMatchPipelineResult = {
  openAiPlanByExactName: Map<string, StoredEpocOpenAiPlan>;
  manualReviewExactNames: string[];
};

export async function runEpocProductMatchPipeline(input: {
  admin: SupabaseAdmin;
  companyId: string;
  uniqueNames: Map<string, string>;
  catalog: EpocCatalogProduct[];
  recipes: EpocRecipeCatalogEntry[];
  canonicalIndex: Map<string, string | null>;
  cache: Map<string, string | null>;
  priorOpenAiPlan: Map<string, StoredEpocOpenAiPlan>;
  openaiApiKey: string;
  openaiModel: string;
  productEnsure: EpocProductEnsureCoordinator;
  inferUnit: (raw: string, catalog: EpocCatalogProduct[]) => string;
  mapStockControl: (operationalType: string) => string;
  deriveOperationalType: (categoryName: string, raw: string) => string;
  defaultCategoryName: string;
}): Promise<RunEpocProductMatchPipelineResult> {
  const openAiPlanByExactName = new Map(input.priorOpenAiPlan);
  const manualReviewExactNames: string[] = [];
  const unmatchedForAi: { exactKey: string; raw: string }[] = [];

  for (const [exactKey, raw] of input.uniqueNames) {
    if (input.cache.get(exactKey)) continue;
    const prior = openAiPlanByExactName.get(exactKey);
    if (prior?.action === "MANUAL_REVIEW") {
      manualReviewExactNames.push(exactKey);
      continue;
    }
    if (
      prior &&
      (prior.action === "MATCH_PRODUCT" || prior.action === "MATCH_RECIPE") &&
      prior.product_id
    ) {
      input.cache.set(exactKey, prior.product_id);
      continue;
    }

    const resolved = resolveEpocProductId(
      raw,
      input.catalog,
      input.cache,
      input.canonicalIndex,
      input.recipes,
    );
    if (resolved.ambiguous) {
      manualReviewExactNames.push(exactKey);
      openAiPlanByExactName.set(exactKey, {
        action: "MANUAL_REVIEW",
        instructions:
          "Mais de um produto ativo com o mesmo nome exato; consolidar cadastro.",
      });
      continue;
    }
    if (resolved.productId) {
      const matched = input.catalog.find((p) => p.id === resolved.productId);
      await ensureProductSaleUnitUnConversion(
        input.admin,
        resolved.productId,
        matched?.unit ?? "un",
        null,
      );
      continue;
    }

    if (
      prior?.action === "CREATE_PRODUCT" ||
      prior?.action === "CREATE_RECIPE"
    ) {
      await applyEpocOpenAiCreatePlan({
        exactKey,
        raw,
        plan: prior,
        ...input,
        openAiPlanByExactName,
      });
      continue;
    }

    unmatchedForAi.push({ exactKey, raw });
  }

  if (unmatchedForAi.length && input.openaiApiKey) {
    const labels = unmatchedForAi.map((u) => u.raw);
    const aiMap = await batchResolveEpocUnmatchedWithOpenAi({
      apiKey: input.openaiApiKey,
      model: input.openaiModel,
      csvLines: labels,
      products: input.catalog,
      recipes: input.recipes,
    });

    for (let i = 0; i < unmatchedForAi.length; i++) {
      const { exactKey, raw } = unmatchedForAi[i]!;
      const assignment: EpocOpenAiMatchAssignment | undefined = aiMap.get(i);
      if (!assignment) {
        manualReviewExactNames.push(exactKey);
        openAiPlanByExactName.set(exactKey, {
          action: "MANUAL_REVIEW",
          instructions:
            "Sem resposta da IA; revisar manualmente ou repetir importação.",
        });
        continue;
      }
      const plan = assignmentToStoredPlan(assignment);
      openAiPlanByExactName.set(exactKey, plan);
      if (plan.action === "MANUAL_REVIEW") {
        manualReviewExactNames.push(exactKey);
        continue;
      }
      if (
        (plan.action === "MATCH_PRODUCT" || plan.action === "MATCH_RECIPE") &&
        plan.product_id
      ) {
        const pid = plan.product_id;
        const prod =
          input.catalog.find((p) => p.id === pid) ??
          (await fetchActiveProductRowById(input.admin, input.companyId, pid));
        if (prod) {
          registerResolvedEpocProduct(
            input.catalog,
            input.canonicalIndex,
            input.cache,
            prod,
            epocProductLineKey(raw),
            prod.name,
          );
          await ensureProductSaleUnitUnConversion(
            input.admin,
            pid,
            prod.unit ?? "un",
            null,
          );
        } else {
          manualReviewExactNames.push(exactKey);
        }
        continue;
      }
      if (
        plan.action === "CREATE_PRODUCT" ||
        plan.action === "CREATE_RECIPE"
      ) {
        await applyEpocOpenAiCreatePlan({
          exactKey,
          raw,
          plan,
          ...input,
          openAiPlanByExactName,
        });
      }
    }
  } else if (unmatchedForAi.length) {
    for (const { exactKey } of unmatchedForAi) {
      manualReviewExactNames.push(exactKey);
      openAiPlanByExactName.set(exactKey, {
        action: "MANUAL_REVIEW",
        instructions:
          "OPENAI_API_KEY ausente; cadastre o produto ou configure a chave.",
      });
    }
  }

  return { openAiPlanByExactName, manualReviewExactNames };
}

function assignmentToStoredPlan(a: EpocOpenAiMatchAssignment): StoredEpocOpenAiPlan {
  if (a.action === "MATCH_PRODUCT") {
    return {
      action: a.action,
      product_id: a.product_id ?? null,
    };
  }
  if (a.action === "MATCH_RECIPE") {
    return {
      action: a.action,
      product_id: a.product_id ?? null,
      recipe_id: a.recipe_id ?? null,
    };
  }
  if (a.action === "CREATE_PRODUCT" || a.action === "CREATE_RECIPE") {
    return {
      action: a.action,
      create: a.create ?? null,
    };
  }
  return {
    action: "MANUAL_REVIEW",
    instructions: a.instructions ?? "Revisão manual necessária.",
  };
}

async function fetchActiveProductRowById(
  admin: SupabaseAdmin,
  companyId: string,
  productId: string,
): Promise<EpocCatalogProduct | null> {
  const { data, error } = await admin
    .from("products")
    .select("id, name, unit, canonical_name")
    .eq("company_id", companyId)
    .eq("id", productId)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data?.id) return null;
  return {
    id: String(data.id),
    name: String(data.name ?? ""),
    unit: (data.unit as string | null) ?? null,
    canonical_name: (data.canonical_name as string | null) ?? null,
  };
}

async function applyEpocOpenAiCreatePlan(ctx: {
  exactKey: string;
  raw: string;
  plan: StoredEpocOpenAiPlan;
  admin: SupabaseAdmin;
  companyId: string;
  catalog: EpocCatalogProduct[];
  recipes: EpocRecipeCatalogEntry[];
  canonicalIndex: Map<string, string | null>;
  cache: Map<string, string | null>;
  productEnsure: EpocProductEnsureCoordinator;
  inferUnit: (raw: string, catalog: EpocCatalogProduct[]) => string;
  mapStockControl: (operationalType: string) => string;
  deriveOperationalType: (categoryName: string, raw: string) => string;
  defaultCategoryName: string;
  openAiPlanByExactName: Map<string, StoredEpocOpenAiPlan>;
}): Promise<void> {
  const create = ctx.plan.create;
  if (!create?.catalog_name) return;
  const asRecipe = ctx.plan.action === "CREATE_RECIPE" || create.kind === "RECIPE";
  const catalogName = epocCatalogDisplayName(create.catalog_name);
  const unit = (create.unit || "un").trim().toLowerCase() || "un";
  const autoOp = asRecipe
    ? "RECEITA_FICHA"
    : ctx.deriveOperationalType(ctx.defaultCategoryName, ctx.raw);
  const ensured = await ctx.productEnsure.ensure({
    rawName: ctx.raw,
    catalogName,
    lineKey: epocProductLineKey(ctx.raw),
    canonicalName: canonicalProductName(catalogName) || ctx.exactKey,
    inferredUnit: unit,
    autoStock: asRecipe ? "RECIPE_CONTROLLED" : ctx.mapStockControl(autoOp),
  });
  if (!ensured.productId) return;
  await ensureProductSaleUnitUnConversion(
    ctx.admin,
    ensured.productId,
    unit,
    create.un_per_stock_unit ?? null,
  );
  if (asRecipe && ensured.created) {
    await ctx.admin.from("recipes").insert({
      company_id: ctx.companyId,
      name: catalogName.slice(0, 500),
      output_product_id: ensured.productId,
      batch_yield: 1,
      active: true,
      recipe_type: "PREP",
    });
  }
}

/** Garante conversão da unidade de estoque para UN (vendas EPOC em un). */
export async function ensureProductSaleUnitUnConversion(
  admin: SupabaseAdmin,
  productId: string,
  hubUnit: string,
  unPerStockUnit: number | null,
): Promise<void> {
  const hub = (hubUnit || "un").trim().toLowerCase();
  if (hub === "un") return;

  const secondaryQty =
    unPerStockUnit != null &&
    Number.isFinite(Number(unPerStockUnit)) &&
    Number(unPerStockUnit) > 0
      ? Number(unPerStockUnit)
      : 1;

  await appendProductUnitConversionOnProduct(admin, productId, hub, {
    primary_qty: 1,
    primary_unit_code: hub,
    secondary_unit_code: "un",
    secondary_qty: secondaryQty,
  });
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
      [],
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
      [],
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

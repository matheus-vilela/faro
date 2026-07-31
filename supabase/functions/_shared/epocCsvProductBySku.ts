/**
 * Resolução simples de produto no import CSV EPOC:
 * - identificador = coluna Codigo → `products.sku`
 * - se existir (ativo), reutiliza; senão cria com unit=un
 * - coluna Grupo → categoria de catálogo (`company_product_categories`); cria se faltar
 */
// deno-lint-ignore no-explicit-any
type Admin = any;

export type EpocSkuProduct = {
  id: string;
  name: string;
  sku: string;
  unit: string;
};

export type EnsureEpocProductBySkuResult = {
  productId: string | null;
  created: boolean;
  error?: string;
};

function normalizeSku(raw: string): string {
  return String(raw ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .trim();
}

function normalizeCategoryName(raw: string): string {
  return String(raw ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cache sku → product_id (metadata entre chunks). */
export function loadSkuProductCacheFromMetadata(
  meta: Record<string, unknown> | undefined,
): Map<string, string> {
  const out = new Map<string, string>();
  const raw = meta?.epoc_product_id_by_sku;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const sku = normalizeSku(k);
    if (sku && typeof v === "string" && v.trim()) out.set(sku, v.trim());
  }
  return out;
}

export function skuProductCacheToMetadata(
  cache: Map<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of cache.entries()) {
    if (k && v) out[k] = v;
  }
  return out;
}

export async function ensureCompanyProductCategoryByName(
  admin: Admin,
  companyId: string,
  grupoName: string,
  localCache: Map<string, string>,
): Promise<string | null> {
  const name = normalizeCategoryName(grupoName);
  if (!name) return null;

  const key = name.toLowerCase();
  const cached = localCache.get(key);
  if (cached) return cached;

  const { data: existing, error: findErr } = await admin
    .from("company_product_categories")
    .select("id, name")
    .eq("company_id", companyId)
    .ilike("name", name.replace(/[%_]/g, "\\$&"))
    .limit(1)
    .maybeSingle();
  if (findErr) {
    console.error(
      "[epocCsvProductBySku] category lookup:",
      findErr.message,
    );
  }
  if (existing?.id) {
    const id = String(existing.id);
    localCache.set(key, id);
    return id;
  }

  const { data: created, error: insErr } = await admin
    .from("company_product_categories")
    .insert({
      company_id: companyId,
      name,
      sort_order: 500,
    })
    .select("id")
    .single();

  if (insErr) {
    // Corrida / unique: reconsulta
    const { data: again } = await admin
      .from("company_product_categories")
      .select("id")
      .eq("company_id", companyId)
      .ilike("name", name)
      .limit(1)
      .maybeSingle();
    if (again?.id) {
      const id = String(again.id);
      localCache.set(key, id);
      return id;
    }
    console.error(
      "[epocCsvProductBySku] category insert:",
      insErr.message,
    );
    return null;
  }

  const id = String(created.id);
  localCache.set(key, id);
  return id;
}

async function assignProductCategory(
  admin: Admin,
  companyId: string,
  productId: string,
  categoryId: string,
): Promise<void> {
  const { error } = await admin.from("product_category_assignments").insert({
    company_id: companyId,
    product_id: productId,
    category_id: categoryId,
  });
  if (error && !/duplicate key/i.test(error.message)) {
    console.error(
      "[epocCsvProductBySku] product_category_assignments:",
      error.message,
    );
  }
}

/**
 * Garante produto EPOC pelo código (sku). Sempre unit=un, stock DIRECT.
 * Opcionalmente associa categoria de catálogo pelo nome do Grupo.
 */
export async function ensureEpocProductBySku(input: {
  admin: Admin;
  companyId: string;
  sku: string;
  name: string;
  grupoName?: string | null;
  skuCache: Map<string, string>;
  categoryCache: Map<string, string>;
}): Promise<EnsureEpocProductBySkuResult> {
  const sku = normalizeSku(input.sku);
  if (!sku) {
    return { productId: null, created: false, error: "codigo_vazio" };
  }

  const cached = input.skuCache.get(sku);
  if (cached) {
    if (input.grupoName) {
      const catId = await ensureCompanyProductCategoryByName(
        input.admin,
        input.companyId,
        input.grupoName,
        input.categoryCache,
      );
      if (catId) {
        await assignProductCategory(
          input.admin,
          input.companyId,
          cached,
          catId,
        );
      }
    }
    return { productId: cached, created: false };
  }

  const { data: existing, error: findErr } = await input.admin
    .from("products")
    .select("id, name, sku, unit")
    .eq("company_id", input.companyId)
    .eq("is_active", true)
    .eq("sku", sku)
    .limit(1)
    .maybeSingle();

  if (findErr) {
    console.error("[epocCsvProductBySku] sku lookup:", findErr.message);
  }

  let productId: string | null = existing?.id ? String(existing.id) : null;
  let created = false;

  if (!productId) {
    const productName =
      normalizeCategoryName(input.name) || `EPOC ${sku}`;
    const { data: inserted, error: insErr } = await input.admin
      .from("products")
      .insert({
        company_id: input.companyId,
        name: productName,
        sku,
        unit: "un",
        min_quantity: 0,
        current_quantity: 0,
        is_active: true,
        stock_control_type: "DIRECT",
      })
      .select("id")
      .single();

    if (insErr || !inserted?.id) {
      // Possível corrida: reconsulta por sku
      const { data: again } = await input.admin
        .from("products")
        .select("id")
        .eq("company_id", input.companyId)
        .eq("is_active", true)
        .eq("sku", sku)
        .limit(1)
        .maybeSingle();
      if (again?.id) {
        productId = String(again.id);
        created = false;
      } else {
        console.error(
          "[epocCsvProductBySku] product insert:",
          insErr?.message ?? "sem id",
        );
        return {
          productId: null,
          created: false,
          error: insErr?.message ?? "falha_criar_produto",
        };
      }
    } else {
      productId = String(inserted.id);
      created = true;
    }
  }

  input.skuCache.set(sku, productId);

  if (input.grupoName) {
    const catId = await ensureCompanyProductCategoryByName(
      input.admin,
      input.companyId,
      input.grupoName,
      input.categoryCache,
    );
    if (catId) {
      await assignProductCategory(
        input.admin,
        input.companyId,
        productId,
        catId,
      );
    }
  }

  return { productId, created };
}

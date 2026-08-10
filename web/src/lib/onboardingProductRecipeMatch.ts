import { syncFlagIsExplicitOff } from "@/lib/onboardingFiscalDashboard";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PurchaseUtilizationTipo = "PRODUTO" | "FICHA_TECNICA";

export type PurchaseUtilization = {
  tipo: PurchaseUtilizationTipo;
  idDestino: string;
  nomeDestino: string;
};

export type ProductRecipeMatchRow = {
  product_id: string;
  name: string;
  unit: string;
  current_quantity: number;
  sku?: string | null;
  ean?: string | null;
  barcode?: string | null;
  recipe_id?: string | null;
};

export type PurchaseMatchRow = ProductRecipeMatchRow & {
  utilizations: PurchaseUtilization[];
};

export type RecipePickRow = {
  id: string;
  name: string;
  output_product_id: string | null;
};

function parseMatchRow(
  raw: unknown,
  withRecipe: boolean,
): ProductRecipeMatchRow | null {
  const o = raw as Record<string, unknown>;
  const id = String(o.product_id ?? "").trim();
  if (!id) return null;
  const row: ProductRecipeMatchRow = {
    product_id: id,
    name: String(o.name ?? "Produto").trim() || "Produto",
    unit: String(o.unit ?? "").trim() || "—",
    current_quantity: Number(o.current_quantity ?? 0),
    sku: o.sku != null ? String(o.sku).trim() || null : null,
    ean: o.ean != null ? String(o.ean).trim() || null : null,
    barcode: o.barcode != null ? String(o.barcode).trim() || null : null,
  };
  if (withRecipe) {
    const rid = String(o.recipe_id ?? "").trim();
    row.recipe_id = rid || null;
  }
  return row;
}

function parseUtilization(raw: unknown): PurchaseUtilization | null {
  const o = raw as Record<string, unknown>;
  const tipoRaw = String(o.tipo ?? "").trim().toUpperCase();
  const tipo: PurchaseUtilizationTipo | null =
    tipoRaw === "FICHA_TECNICA" || tipoRaw === "PRODUTO"
      ? (tipoRaw as PurchaseUtilizationTipo)
      : null;
  const idDestino = String(o.idDestino ?? o.id_destino ?? "").trim();
  const nomeDestino = String(o.nomeDestino ?? o.nome_destino ?? "").trim();
  if (!tipo || !idDestino) return null;
  return {
    tipo,
    idDestino,
    nomeDestino: nomeDestino || "—",
  };
}

function parsePurchaseRow(raw: unknown): PurchaseMatchRow | null {
  const base = parseMatchRow(raw, false);
  if (!base) return null;
  const o = raw as Record<string, unknown>;
  const utilRaw = o.utilizations;
  const utilizations = Array.isArray(utilRaw)
    ? utilRaw
        .map(parseUtilization)
        .filter((x): x is PurchaseUtilization => x != null)
    : [];
  return { ...base, utilizations };
}

/** Ambos os fluxos terminaram de sincronizar (`sync` explicitamente false). */
export function isOnboardingProductRecipeMatchVisible(
  onboardingFiscal: unknown,
  onboardingPdv: unknown,
): boolean {
  const fiscal =
    onboardingFiscal && typeof onboardingFiscal === "object"
      ? (onboardingFiscal as Record<string, unknown>)
      : null;
  const pdv =
    onboardingPdv && typeof onboardingPdv === "object"
      ? (onboardingPdv as Record<string, unknown>)
      : null;
  if (!fiscal || !pdv) return false;
  if (!("sync" in fiscal) || !("sync" in pdv)) return false;
  return syncFlagIsExplicitOff(fiscal.sync) && syncFlagIsExplicitOff(pdv.sync);
}

export async function fetchProductRecipeMatchLists(
  client: SupabaseClient,
  companyId: string,
  opts?: {
    purchaseLimit?: number;
    purchaseOffset?: number;
    soldLimit?: number;
    soldOffset?: number;
  },
): Promise<{
  purchases: PurchaseMatchRow[];
  soldOnly: ProductRecipeMatchRow[];
  purchasesTotal: number;
  purchasesWithoutUtilTotal: number;
  soldTotal: number;
  error: string | null;
}> {
  const purchaseLimit = opts?.purchaseLimit ?? 40;
  const purchaseOffset = opts?.purchaseOffset ?? 0;
  const soldLimit = opts?.soldLimit ?? 80;
  const soldOffset = opts?.soldOffset ?? 0;

  const { data, error } = await client.rpc("dashboard_product_recipe_match_lists", {
    p_company_id: companyId,
    p_purchase_limit: purchaseLimit,
    p_purchase_offset: purchaseOffset,
    p_sold_limit: soldLimit,
    p_sold_offset: soldOffset,
  });
  if (error) {
    return {
      purchases: [],
      soldOnly: [],
      purchasesTotal: 0,
      purchasesWithoutUtilTotal: 0,
      soldTotal: 0,
      error: error.message,
    };
  }
  const payload = data as {
    purchases?: unknown;
    sold_only?: unknown;
    purchases_total?: unknown;
    purchases_without_util_total?: unknown;
    sold_total?: unknown;
    /** Legado (pré-utilizações) — ignorado se `purchases` existir. */
    exit_only?: unknown;
    entry_only?: unknown;
  };

  const purchasesRaw = Array.isArray(payload?.purchases)
    ? payload.purchases
    : Array.isArray(payload?.entry_only)
      ? payload.entry_only
      : [];
  const soldRaw = Array.isArray(payload?.sold_only)
    ? payload.sold_only
    : Array.isArray(payload?.exit_only)
      ? payload.exit_only
      : [];

  const purchases = purchasesRaw
    .map(parsePurchaseRow)
    .filter((x): x is PurchaseMatchRow => x != null);
  const soldOnly = soldRaw
    .map((r) => parseMatchRow(r, true))
    .filter((x): x is ProductRecipeMatchRow => x != null);

  const purchasesTotal = Number(payload?.purchases_total ?? purchases.length);
  const purchasesWithoutUtilTotal = Number(
    payload?.purchases_without_util_total ??
      purchases.filter((p) => p.utilizations.length === 0).length,
  );
  const soldTotal = Number(payload?.sold_total ?? soldOnly.length);

  return {
    purchases,
    soldOnly,
    purchasesTotal: Number.isFinite(purchasesTotal) ? purchasesTotal : 0,
    purchasesWithoutUtilTotal: Number.isFinite(purchasesWithoutUtilTotal)
      ? purchasesWithoutUtilTotal
      : 0,
    soldTotal: Number.isFinite(soldTotal) ? soldTotal : 0,
    error: null,
  };
}

/** Contagem leve de compras só-entrada sem utilização (ficha). */
export async function fetchPurchaseWithoutUtilCount(
  client: SupabaseClient,
  companyId: string,
): Promise<{ count: number; error: string | null }> {
  const lists = await fetchProductRecipeMatchLists(client, companyId, {
    purchaseLimit: 0,
    purchaseOffset: 0,
    soldLimit: 0,
    soldOffset: 0,
  });
  if (lists.error) {
    return { count: 0, error: lists.error };
  }
  return { count: lists.purchasesWithoutUtilTotal, error: null };
}

export const RECIPE_MATCH_PURCHASE_PAGE_SIZE = 40;
export const RECIPE_MATCH_SOLD_PAGE_SIZE = 80;
export const RECIPE_MATCH_SOLD_MORE_SIZE = 40;

export async function fetchCompanyRecipesForPick(
  client: SupabaseClient,
  companyId: string,
): Promise<{ rows: RecipePickRow[]; error: string | null }> {
  const { data, error } = await client
    .from("recipes")
    .select("id, name, output_product_id")
    .eq("company_id", companyId)
    .or("active.is.null,active.eq.true")
    .order("name")
    .limit(300);
  if (error) return { rows: [], error: error.message };
  const rows = (data ?? [])
    .map((r) => {
      const id = String((r as { id?: string }).id ?? "").trim();
      if (!id) return null;
      return {
        id,
        name: String((r as { name?: string }).name ?? "Ficha").trim() || "Ficha",
        output_product_id: (r as { output_product_id?: string | null })
          .output_product_id
          ? String((r as { output_product_id: string }).output_product_id)
          : null,
      } satisfies RecipePickRow;
    })
    .filter((x): x is RecipePickRow => x != null);
  return { rows, error: null };
}

export type RecipeMatchDraftIngredient = {
  product_id: string;
  name: string;
  input_quantity: number;
  input_unit_code: string;
  stock_quantity: number;
};

export async function createProductRecipeMatch(
  client: SupabaseClient,
  params: {
    companyId: string;
    outputProductId: string;
    ingredients: RecipeMatchDraftIngredient[];
  },
): Promise<{ ok: boolean; recipe_id?: string; ingredients_count?: number; error?: string }> {
  const { data, error } = await client.rpc("dashboard_product_recipe_match_create_recipe", {
    p_company_id: params.companyId,
    p_output_product_id: params.outputProductId,
    p_ingredients: params.ingredients.map((i) => ({
      product_id: i.product_id,
      input_quantity: i.input_quantity,
      input_unit_code: i.input_unit_code,
    })),
  });
  if (error) return { ok: false, error: error.message };
  const row = data as {
    ok?: boolean;
    recipe_id?: string;
    ingredients_count?: number;
    error?: string;
    message?: string;
  };
  if (!row?.ok) {
    return {
      ok: false,
      error: row?.message ?? row?.error ?? "Não foi possível criar a ficha.",
    };
  }
  return {
    ok: true,
    recipe_id: row.recipe_id ? String(row.recipe_id) : undefined,
    ingredients_count: Number(row.ingredients_count ?? 0),
  };
}

/** Liga insumo a ficha existente do output (ou cria ficha se ainda não houver). */
export async function linkProductRecipeMatch(
  client: SupabaseClient,
  params: {
    companyId: string;
    outputProductId: string;
    ingredientProductId: string;
    inputQuantity: number;
    inputUnitCode: string;
    upsertConversion?: boolean;
    convSecondaryUnitCode?: string | null;
    convPrimaryQty?: number | null;
    convSecondaryQty?: number | null;
  },
): Promise<{
  ok: boolean;
  recipe_id?: string;
  already_linked?: boolean;
  error?: string;
}> {
  const { data, error } = await client.rpc("dashboard_product_recipe_match_link", {
    p_company_id: params.companyId,
    p_output_product_id: params.outputProductId,
    p_ingredient_product_id: params.ingredientProductId,
    p_input_quantity: params.inputQuantity,
    p_input_unit_code: params.inputUnitCode,
    p_upsert_conversion: params.upsertConversion ?? false,
    p_conv_secondary_unit_code: params.convSecondaryUnitCode ?? null,
    p_conv_primary_qty: params.convPrimaryQty ?? null,
    p_conv_secondary_qty: params.convSecondaryQty ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const row = data as {
    ok?: boolean;
    recipe_id?: string;
    already_linked?: boolean;
    error?: string;
    message?: string;
  };
  if (!row?.ok) {
    return {
      ok: false,
      error: row?.message ?? row?.error ?? "Não foi possível ligar o insumo.",
    };
  }
  return {
    ok: true,
    recipe_id: row.recipe_id ? String(row.recipe_id) : undefined,
    already_linked: row.already_linked === true,
  };
}

export async function addPurchaseAsRecipeIngredient(
  client: SupabaseClient,
  params: {
    companyId: string;
    recipeId: string;
    ingredientProductId: string;
    inputQuantity: number;
    inputUnitCode: string;
    upsertConversion?: boolean;
    convSecondaryUnitCode?: string | null;
    convPrimaryQty?: number | null;
    convSecondaryQty?: number | null;
  },
): Promise<{ ok: boolean; already_linked?: boolean; error?: string }> {
  const { data, error } = await client.rpc("dashboard_product_recipe_add_ingredient", {
    p_company_id: params.companyId,
    p_recipe_id: params.recipeId,
    p_ingredient_product_id: params.ingredientProductId,
    p_input_quantity: params.inputQuantity,
    p_input_unit_code: params.inputUnitCode,
    p_upsert_conversion: params.upsertConversion ?? false,
    p_conv_secondary_unit_code: params.convSecondaryUnitCode ?? null,
    p_conv_primary_qty: params.convPrimaryQty ?? null,
    p_conv_secondary_qty: params.convSecondaryQty ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const row = data as {
    ok?: boolean;
    already_linked?: boolean;
    error?: string;
    message?: string;
  };
  if (!row?.ok) {
    return {
      ok: false,
      error: recipeMatchCreateErrorMessage(row?.error) || row?.message,
    };
  }
  return { ok: true, already_linked: row.already_linked === true };
}

export async function removePurchaseRecipeIngredient(
  client: SupabaseClient,
  params: {
    companyId: string;
    recipeId: string;
    ingredientProductId: string;
  },
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await client.rpc(
    "dashboard_product_recipe_remove_ingredient",
    {
      p_company_id: params.companyId,
      p_recipe_id: params.recipeId,
      p_ingredient_product_id: params.ingredientProductId,
    },
  );
  if (error) return { ok: false, error: error.message };
  const row = data as { ok?: boolean; error?: string; message?: string };
  if (!row?.ok) {
    const code = row?.error ?? "unknown";
    const messages: Record<string, string> = {
      recipe_not_found: "Ficha técnica não encontrada.",
      ingredient_not_linked: "Este produto não está nesta ficha.",
      forbidden: "Sem permissão para esta unidade.",
    };
    return {
      ok: false,
      error: messages[code] ?? row?.message ?? "Não foi possível remover o vínculo.",
    };
  }
  return { ok: true };
}

export type ProductRecipeUtilization = {
  recipe_id: string;
  recipe_name: string;
  input_quantity: number | null;
  input_unit_code: string | null;
};

export async function fetchProductRecipeUtilizations(
  client: SupabaseClient,
  companyId: string,
  productId: string,
): Promise<{ rows: ProductRecipeUtilization[]; error: string | null }> {
  const { data, error } = await client
    .from("recipe_ingredients")
    .select(
      "input_quantity, input_unit_code, recipes!inner(id, name, company_id, active)",
    )
    .eq("product_id", productId)
    .eq("recipes.company_id", companyId);

  if (error) return { rows: [], error: error.message };

  const rows: ProductRecipeUtilization[] = [];
  for (const raw of data ?? []) {
    const row = raw as {
      input_quantity?: number | null;
      input_unit_code?: string | null;
      recipes?:
        | { id?: string; name?: string; active?: boolean | null }
        | { id?: string; name?: string; active?: boolean | null }[]
        | null;
    };
    const recipe = Array.isArray(row.recipes) ? row.recipes[0] : row.recipes;
    const recipeId = String(recipe?.id ?? "").trim();
    if (!recipeId) continue;
    if (recipe?.active === false) continue;
    rows.push({
      recipe_id: recipeId,
      recipe_name:
        String(recipe?.name ?? "Ficha").trim() || "Ficha",
      input_quantity:
        row.input_quantity == null || !Number.isFinite(Number(row.input_quantity))
          ? null
          : Number(row.input_quantity),
      input_unit_code: row.input_unit_code
        ? String(row.input_unit_code).trim() || null
        : null,
    });
  }
  rows.sort((a, b) =>
    a.recipe_name.localeCompare(b.recipe_name, "pt-BR", {
      sensitivity: "base",
    }),
  );
  return { rows, error: null };
}

export function recipeMatchCreateErrorMessage(code: string | undefined): string {
  switch (code) {
    case "ingredients_required":
      return "Adicione pelo menos um insumo à lista antes de criar a ficha.";
    case "recipe_already_exists":
      return "Este prato já possui ficha técnica. Use «Adicionar à ficha» ou ajuste em Produtos → Receitas.";
    case "unit_conversion_failed":
      return "Não foi possível converter a unidade de um insumo. Revise as conversões.";
    case "duplicate_ingredient":
      return "A lista contém o mesmo insumo mais de uma vez.";
    case "same_product":
      return "O prato não pode ser insumo de si mesmo.";
    case "product_not_found":
      return "Produto não encontrado.";
    case "recipe_not_found":
      return "Ficha técnica não encontrada.";
    case "forbidden":
      return "Sem permissão para esta unidade.";
    default:
      return code ?? "Não foi possível criar a ficha.";
  }
}

export async function undoProductRecipeMatch(
  client: SupabaseClient,
  companyId: string,
  recipeId: string,
): Promise<{ ok: boolean; output_product_id?: string; error?: string }> {
  const { data, error } = await client.rpc("dashboard_product_recipe_undo", {
    p_company_id: companyId,
    p_recipe_id: recipeId,
  });
  if (error) return { ok: false, error: error.message };
  const row = data as {
    ok?: boolean;
    output_product_id?: string;
    error?: string;
    message?: string;
  };
  if (!row?.ok) {
    const code = row?.error ?? "unknown";
    return {
      ok: false,
      error: recipeMatchUndoErrorMessage(code, row?.message),
    };
  }
  return {
    ok: true,
    output_product_id: row.output_product_id
      ? String(row.output_product_id)
      : undefined,
  };
}

export function recipeMatchUndoErrorMessage(
  code: string | undefined,
  fallbackMessage?: string,
): string {
  switch (code) {
    case "recipe_not_found":
      return "Ficha técnica não encontrada.";
    case "recipe_sale_entries_exist":
      return "Existem vendas ligadas à ficha; não é possível desfazer automaticamente.";
    case "forbidden":
      return "Sem permissão para esta unidade.";
    case "not_authenticated":
      return "Sessão expirada. Entre novamente.";
    default:
      return (
        fallbackMessage ??
        code ??
        "Não foi possível desfazer a ficha técnica."
      );
  }
}

function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Pontuação heurística para sugerir pares só-saída ↔ só-entrada (EAN/SKU/nome). */
export function recipeMatchSuggestionScore(
  a: ProductRecipeMatchRow,
  b: ProductRecipeMatchRow,
): number {
  let score = 0;
  const ae = (a.ean || a.barcode || "").trim();
  const be = (b.ean || b.barcode || "").trim();
  if (ae && be && ae === be) score += 100;
  const as = (a.sku || "").trim().toLowerCase();
  const bs = (b.sku || "").trim().toLowerCase();
  if (as && bs && as === bs) score += 80;
  const an = normalizeText(a.name);
  const bn = normalizeText(b.name);
  if (!an || !bn) return score;
  if (an === bn) score += 60;
  else if (an.includes(bn) || bn.includes(an)) score += 40;
  else {
    const at = an.split(/\s+/).filter((t) => t.length > 2);
    const bt = bn.split(/\s+/).filter((t) => t.length > 2);
    const shorter = at.length <= bt.length ? at : bt;
    const longerArr = at.length <= bt.length ? bt : at;
    const shorterSet = new Set(shorter);
    const longerSet = new Set(longerArr);
    if (shorter.length >= 2) {
      const matchedShort = shorter.filter((t) => longerSet.has(t)).length;
      const matchedLong = longerArr.filter((t) => shorterSet.has(t)).length;
      const covShort = matchedShort / shorter.length;
      const covLong = matchedLong / longerArr.length;
      if (covShort >= 1 && covLong >= 0.75) score += 50;
      else if (covShort >= 0.75 && covLong >= 0.75) score += 40;
      else score += matchedShort * 8;
    } else {
      const matched = shorter.filter((t) => longerSet.has(t)).length;
      score += matched * 8;
    }
  }
  return score;
}

export function bestSoldSuggestionForPurchase(
  purchase: ProductRecipeMatchRow,
  soldOnly: ProductRecipeMatchRow[],
): { sold: ProductRecipeMatchRow; score: number } | null {
  let best: { sold: ProductRecipeMatchRow; score: number } | null = null;
  for (const sold of soldOnly) {
    const score = recipeMatchSuggestionScore(purchase, sold);
    if (score < RECIPE_MATCH_SUGGESTION_THRESHOLD) continue;
    if (!best || score > best.score) best = { sold, score };
  }
  return best;
}

export const RECIPE_MATCH_SUGGESTION_THRESHOLD = 40;

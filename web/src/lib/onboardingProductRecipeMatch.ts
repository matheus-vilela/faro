import { syncFlagIsExplicitOff } from "@/lib/onboardingFiscalDashboard";
import type { SupabaseClient } from "@supabase/supabase-js";

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

function parseList(raw: unknown, withRecipe: boolean): ProductRecipeMatchRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => parseMatchRow(r, withRecipe))
    .filter((x): x is ProductRecipeMatchRow => x != null);
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
): Promise<{
  exitOnly: ProductRecipeMatchRow[];
  entryOnly: ProductRecipeMatchRow[];
  error: string | null;
}> {
  const { data, error } = await client.rpc("dashboard_product_recipe_match_lists", {
    p_company_id: companyId,
  });
  if (error) {
    return { exitOnly: [], entryOnly: [], error: error.message };
  }
  const payload = data as {
    exit_only?: unknown;
    entry_only?: unknown;
  };
  return {
    exitOnly: parseList(payload?.exit_only, true),
    entryOnly: parseList(payload?.entry_only, false),
    error: null,
  };
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
    const at = new Set(an.split(/\s+/).filter((t) => t.length > 2));
    for (const t of bn.split(/\s+/).filter((t) => t.length > 2)) {
      if (at.has(t)) score += 8;
    }
  }
  return score;
}

export const RECIPE_MATCH_SUGGESTION_THRESHOLD = 40;

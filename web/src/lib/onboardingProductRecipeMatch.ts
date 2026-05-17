import { syncFlagIsExplicitOff } from "@/lib/onboardingFiscalDashboard";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ProductRecipeMatchRow = {
  product_id: string;
  name: string;
  unit: string;
  current_quantity: number;
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

export function recipeMatchCreateErrorMessage(code: string | undefined): string {
  switch (code) {
    case "ingredients_required":
      return "Adicione pelo menos um insumo à lista antes de criar a ficha.";
    case "recipe_already_exists":
      return "Este prato já possui ficha técnica. Ajuste em Produtos → Receitas.";
    case "unit_conversion_failed":
      return "Não foi possível converter a unidade de um insumo. Revise as conversões.";
    case "duplicate_ingredient":
      return "A lista contém o mesmo insumo mais de uma vez.";
    case "same_product":
      return "O prato não pode ser insumo de si mesmo.";
    default:
      return code ?? "Não foi possível criar a ficha.";
  }
}

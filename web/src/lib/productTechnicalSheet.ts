import type { TechnicalSheetKind } from "@/lib/productIntermediate";
import { supabase } from "@/lib/supabase";

export type TechnicalSheetIngredient = {
  product_id: string;
  name: string;
  unit: string;
  input_quantity: number;
  input_unit_code: string;
  stock_quantity?: number;
};

export type TechnicalSheetData = {
  recipe_id: string | null;
  recipe_name: string | null;
  batch_yield: number;
  sheet_kind: TechnicalSheetKind | null;
  ingredients: TechnicalSheetIngredient[];
};

export async function fetchProductTechnicalSheet(
  companyId: string,
  outputProductId: string,
): Promise<{ data: TechnicalSheetData | null; error: string | null }> {
  const { data, error } = await supabase.rpc("get_product_technical_sheet", {
    p_company_id: companyId,
    p_output_product_id: outputProductId,
  });
  if (error) return { data: null, error: error.message };

  const row = data as {
    ok?: boolean;
    error?: string;
    recipe?: {
      id?: string;
      name?: string;
      batch_yield?: number;
      recipe_type?: string;
    } | null;
    ingredients?: unknown;
    sheet_kind?: string | null;
  };

  if (!row?.ok) {
    return { data: null, error: row?.error ?? "Não foi possível carregar a ficha." };
  }

  const recipe = row.recipe;
  const ingredients = Array.isArray(row.ingredients)
    ? row.ingredients
        .map((raw): TechnicalSheetIngredient | null => {
          const o = raw as Record<string, unknown>;
          const id = String(o.product_id ?? "").trim();
          if (!id) return null;
          return {
            product_id: id,
            name: String(o.name ?? "Produto").trim() || "Produto",
            unit: String(o.unit ?? "un").trim() || "un",
            input_quantity: Number(o.input_quantity ?? 1),
            input_unit_code: String(o.input_unit_code ?? o.unit ?? "un")
              .trim()
              .toLowerCase(),
            stock_quantity: Number(o.stock_quantity ?? 0),
          };
        })
        .filter((x): x is TechnicalSheetIngredient => x != null)
    : [];

  return {
    data: {
      recipe_id: recipe?.id ? String(recipe.id) : null,
      recipe_name: recipe?.name ? String(recipe.name) : null,
      batch_yield: Number(recipe?.batch_yield ?? 1) || 1,
      sheet_kind:
        row.sheet_kind === "intermediate" ||
        recipe?.recipe_type === "PRODUCTION"
          ? "intermediate"
          : recipe?.id
            ? "sale"
            : null,
      ingredients,
    },
    error: null,
  };
}

export async function saveProductTechnicalSheet(
  companyId: string,
  outputProductId: string,
  ingredients: Array<{
    product_id: string;
    input_quantity: number;
    input_unit_code: string;
  }>,
  batchYield = 1,
  sheetKind: TechnicalSheetKind = "sale",
): Promise<{
  ok: boolean;
  recipe_id?: string;
  error?: string;
  backfill?: {
    output_out_movements: number;
    ingredient_movements_created: number;
  };
}> {
  const { data, error } = await supabase.rpc("upsert_product_technical_sheet", {
    p_company_id: companyId,
    p_output_product_id: outputProductId,
    p_ingredients: ingredients,
    p_batch_yield: batchYield,
    p_sheet_kind: sheetKind,
  });
  if (error) return { ok: false, error: error.message };

  const row = data as {
    ok?: boolean;
    recipe_id?: string;
    error?: string;
    message?: string;
    backfill?: {
      output_out_movements?: number;
      ingredient_movements_created?: number;
    };
  };
  if (!row?.ok) {
    return {
      ok: false,
      error: technicalSheetErrorMessage(row?.error ?? row?.message),
    };
  }
  const bf = row.backfill as
    | {
        ok?: boolean;
        output_out_movements?: number;
        ingredient_movements_created?: number;
      }
    | undefined;
  const backfill =
    bf &&
    (bf.output_out_movements != null || bf.ingredient_movements_created != null)
      ? {
          output_out_movements: Number(bf.output_out_movements ?? 0),
          ingredient_movements_created: Number(bf.ingredient_movements_created ?? 0),
        }
      : undefined;
  return {
    ok: true,
    recipe_id: row.recipe_id ? String(row.recipe_id) : undefined,
    backfill,
  };
}

export function technicalSheetErrorMessage(code: string | undefined): string {
  switch (code) {
    case "ingredients_required":
      return "Informe pelo menos um insumo que compõe a ficha.";
    case "duplicate_ingredient":
      return "O mesmo insumo aparece mais de uma vez na lista.";
    case "same_product":
      return "O prato não pode ser insumo de si mesmo.";
    case "unit_conversion_failed":
      return "Não foi possível converter a unidade de um insumo. Cadastre a conversão no produto.";
    case "ingredient_not_found":
      return "Um dos insumos selecionados não existe nesta unidade.";
    case "sale_family_forbidden":
      return "Agrupamento não pode virar ficha nem produto intermediário.";
    case "invalid_sheet_kind":
      return "Tipo de ficha inválido.";
    case "forbidden":
      return "Sem permissão para salvar a ficha nesta unidade.";
    case "not_authenticated":
      return "Sessão expirada. Entre novamente.";
    case "output_not_found":
      return "Produto de saída não encontrado. Tente salvar de novo.";
    default:
      if (code?.includes("insufficient_stock")) {
        return "Estoque insuficiente em um ou mais insumos para concluir a saída.";
      }
      if (code?.includes("recipe_stock_propagation") || code?.includes("Falha ao baixar insumos")) {
        return "Estoque insuficiente nos insumos da ficha para esta saída.";
      }
      return code ?? "Não foi possível salvar a ficha técnica.";
  }
}

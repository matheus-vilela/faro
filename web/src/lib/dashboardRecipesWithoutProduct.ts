import type { SupabaseClient } from "@supabase/supabase-js";

export type RecipeWithoutProductRow = {
  recipe_id: string;
  name: string;
  batch_yield: number;
  ingredients_count: number;
};

export async function fetchRecipesWithoutOutputProduct(
  client: SupabaseClient,
  companyId: string,
): Promise<{ rows: RecipeWithoutProductRow[]; error: string | null }> {
  const { data, error } = await client
    .from("recipes")
    .select(
      "id, name, batch_yield, recipe_ingredients(count)",
    )
    .eq("company_id", companyId)
    .is("output_product_id", null)
    .or("active.is.null,active.eq.true")
    .order("name", { ascending: true });

  if (error) {
    return { rows: [], error: error.message };
  }

  const rows: RecipeWithoutProductRow[] = (data ?? [])
    .map((raw) => {
      const r = raw as {
        id: string;
        name: string | null;
        batch_yield: number | string | null;
        recipe_ingredients?: { count: number }[] | { count: number };
      };
      const id = String(r.id ?? "").trim();
      if (!id) return null;
      const ingRaw = r.recipe_ingredients;
      const ingredients_count = Array.isArray(ingRaw)
        ? Number(ingRaw[0]?.count ?? 0)
        : Number((ingRaw as { count: number } | undefined)?.count ?? 0);
      return {
        recipe_id: id,
        name: String(r.name ?? "").trim() || "Ficha técnica",
        batch_yield: Number(r.batch_yield ?? 1) || 1,
        ingredients_count: Number.isFinite(ingredients_count)
          ? Math.max(0, ingredients_count)
          : 0,
      };
    })
    .filter((x): x is RecipeWithoutProductRow => x != null);

  return { rows, error: null };
}

import { supabase } from "@/lib/supabase";
import {
  indexCatalogMixByProductId,
  type CatalogMixCategory,
} from "./catalogMixLabel";

const IN_CHUNK = 200;

async function fetchInChunks<T>(
  ids: string[],
  run: (chunk: string[]) => PromiseLike<{
    data: T[] | null;
    error: { message?: string } | null;
  }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const { data, error } = await run(chunk);
    if (error) throw error;
    out.push(...(data ?? []));
  }
  return out;
}

export type CatalogMixMaps = {
  categoriesByProductId: Map<string, CatalogMixCategory[]>;
  recipeOutputById: Map<string, string | null>;
};

export function emptyCatalogMixMaps(): CatalogMixMaps {
  return {
    categoriesByProductId: new Map(),
    recipeOutputById: new Map(),
  };
}

export async function fetchCatalogMixMaps(input: {
  companyId: string;
  productIds: readonly string[];
  recipeIds: readonly string[];
}): Promise<CatalogMixMaps> {
  const productIds = [...new Set(input.productIds.filter(Boolean))];
  const recipeIds = [...new Set(input.recipeIds.filter(Boolean))];
  if (productIds.length === 0 && recipeIds.length === 0) {
    return emptyCatalogMixMaps();
  }

  const recipeRows =
    recipeIds.length > 0
      ? await fetchInChunks<{ id: string; output_product_id: string | null }>(
          recipeIds,
          (chunk) =>
            supabase
              .from("recipes")
              .select("id, output_product_id")
              .in("id", chunk),
        )
      : [];

  const recipeOutputById = new Map<string, string | null>();
  const assignmentIds = new Set(productIds);
  for (const r of recipeRows) {
    recipeOutputById.set(r.id, r.output_product_id);
    if (r.output_product_id) assignmentIds.add(r.output_product_id);
  }

  const ids = [...assignmentIds];
  if (ids.length === 0) {
    return { categoriesByProductId: new Map(), recipeOutputById };
  }

  const assignmentRows = await fetchInChunks<{
    product_id: string;
    company_product_categories:
      | CatalogMixCategory
      | CatalogMixCategory[]
      | null;
  }>(ids, (chunk) =>
    supabase
      .from("product_category_assignments")
      .select(
        "product_id, company_product_categories ( id, name, sort_order, exclude_from_sales, ativo )",
      )
      .eq("company_id", input.companyId)
      .in("product_id", chunk),
  );

  return {
    categoriesByProductId: indexCatalogMixByProductId(assignmentRows),
    recipeOutputById,
  };
}

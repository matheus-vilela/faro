import type { SupabaseClient } from "@supabase/supabase-js";

export type DashboardImportReviewRow = {
  product_id: string;
  name: string;
  unit: string;
  current_quantity: number;
  priority_import?: boolean;
  priority_epoc?: boolean;
};

export type DashboardEpocRecipeNoIngredientsRow = {
  recipe_id: string;
  product_id: string;
  name: string;
  unit: string;
  priority_epoc?: boolean;
};

function parseRows(raw: unknown): DashboardImportReviewRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r): DashboardImportReviewRow | null => {
      const o = r as Record<string, unknown>;
      const id = String(o.product_id ?? "").trim();
      if (!id) return null;
      return {
        product_id: id,
        name: String(o.name ?? "Produto").trim() || "Produto",
        unit: String(o.unit ?? "").trim() || "—",
        current_quantity: Number(o.current_quantity ?? 0),
        priority_import: o.priority_import === true,
        priority_epoc: o.priority_epoc === true,
      };
    })
    .filter((x): x is DashboardImportReviewRow => x != null);
}

export async function fetchDashboardImportReviewEntryNoExit(
  client: SupabaseClient,
  companyId: string,
): Promise<{ rows: DashboardImportReviewRow[]; error: string | null }> {
  const { data, error } = await client.rpc(
    "dashboard_import_review_entry_no_exit_list",
    {
      p_company_id: companyId,
    },
  );
  if (error) return { rows: [], error: error.message };
  return { rows: parseRows(data), error: null };
}

export async function fetchDashboardImportReviewExitNoEntry(
  client: SupabaseClient,
  companyId: string,
): Promise<{ rows: DashboardImportReviewRow[]; error: string | null }> {
  const { data, error } = await client.rpc(
    "dashboard_import_review_exit_no_entry_list",
    {
      p_company_id: companyId,
    },
  );
  if (error) return { rows: [], error: error.message };
  return { rows: parseRows(data), error: null };
}

function parseEpocRecipeRows(
  raw: unknown,
): DashboardEpocRecipeNoIngredientsRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r): DashboardEpocRecipeNoIngredientsRow | null => {
      const o = r as Record<string, unknown>;
      const recipeId = String(o.recipe_id ?? "").trim();
      const productId = String(o.product_id ?? "").trim();
      if (!recipeId || !productId) return null;
      return {
        recipe_id: recipeId,
        product_id: productId,
        name: String(o.name ?? "Ficha técnica").trim() || "Ficha técnica",
        unit: String(o.unit ?? "").trim() || "—",
        priority_epoc: o.priority_epoc === true,
      };
    })
    .filter((x): x is DashboardEpocRecipeNoIngredientsRow => x != null);
}

export async function fetchDashboardImportReviewEpocRecipesNoIngredients(
  client: SupabaseClient,
  companyId: string,
): Promise<{
  rows: DashboardEpocRecipeNoIngredientsRow[];
  error: string | null;
}> {
  const { data, error } = await client.rpc(
    "dashboard_import_review_epoc_recipes_no_ingredients_list",
    { p_company_id: companyId },
  );
  if (error) return { rows: [], error: error.message };
  return { rows: parseEpocRecipeRows(data), error: null };
}

export async function dashboardImportReviewEpocRecipeRevertToProduct(
  client: SupabaseClient,
  companyId: string,
  productId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await client.rpc(
    "dashboard_import_review_epoc_recipe_revert_to_product",
    {
      p_company_id: companyId,
      p_product_id: productId,
    },
  );
  if (error) return { ok: false, error: error.message };
  const row = data as { ok?: boolean; error?: string; message?: string };
  if (!row?.ok) {
    const code = row?.error ?? "unknown";
    const messages: Record<string, string> = {
      recipe_not_found: "Não há ficha técnica vinculada a este produto.",
      recipe_has_ingredients:
        "Esta ficha já tem insumos; ajuste em Produtos → Fichas técnicas.",
      recipe_sale_entries_exist:
        "Existem vendas ligadas à ficha; não é possível reverter automaticamente.",
      product_not_found: "Produto não encontrado.",
      forbidden: "Sem permissão para esta empresa.",
    };
    return {
      ok: false,
      error:
        messages[code] ??
        row?.message ??
        "Não foi possível converter em produto.",
    };
  }
  return { ok: true };
}

export async function dashboardImportReviewSetResolution(
  client: SupabaseClient,
  params: {
    companyId: string;
    productId: string;
    bucket: "ENTRY_NO_EXIT" | "EXIT_NO_ENTRY" | "RECIPE_NO_INGREDIENTS";
    resolution: "DISMISSED" | "LINK_RECIPE_STARTED";
  },
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await client.rpc(
    "dashboard_import_review_set_resolution",
    {
      p_company_id: params.companyId,
      p_product_id: params.productId,
      p_bucket: params.bucket,
      p_resolution: params.resolution,
    },
  );
  if (error) return { ok: false, error: error.message };
  const row = data as { ok?: boolean; error?: string };
  if (!row?.ok)
    return { ok: false, error: row?.error ?? "Falha ao gravar revisão." };
  return { ok: true };
}

export async function dashboardImportReviewConfirmOutboundAsRecipe(
  client: SupabaseClient,
  companyId: string,
  productId: string,
): Promise<{
  ok: boolean;
  recipe_id?: string;
  revenue_link?: "pending" | "done";
  error?: string;
}> {
  const { data, error } = await client.rpc(
    "dashboard_import_review_confirm_outbound_as_recipe",
    {
      p_company_id: companyId,
      p_product_id: productId,
    },
  );
  if (error) return { ok: false, error: error.message };
  const row = data as {
    ok?: boolean;
    recipe_id?: string;
    revenue_link?: string;
    error?: string;
    message?: string;
  };
  if (!row?.ok) {
    return {
      ok: false,
      error:
        row?.message ?? row?.error ?? "Não foi possível concluir a conversão.",
    };
  }
  const rl = row.revenue_link === "pending" ? "pending" : undefined;
  return {
    ok: true,
    recipe_id: row.recipe_id ? String(row.recipe_id) : undefined,
    revenue_link: rl,
  };
}

export type DashboardPendingRevenueLinkRow = {
  product_id: string;
  name: string;
  recipe_id: string;
  pending_sales_count: number;
};

function parsePendingRevenueRows(
  raw: unknown,
): DashboardPendingRevenueLinkRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      const o = r as Record<string, unknown>;
      const pid = String(o.product_id ?? "").trim();
      const rid = String(o.recipe_id ?? "").trim();
      if (!pid || !rid) return null;
      return {
        product_id: pid,
        name: String(o.name ?? "Produto").trim() || "Produto",
        recipe_id: rid,
        pending_sales_count: Math.max(
          0,
          Math.floor(Number(o.pending_sales_count ?? 0)),
        ),
      };
    })
    .filter((x): x is DashboardPendingRevenueLinkRow => x != null);
}

export async function fetchDashboardImportReviewPendingRevenueLink(
  client: SupabaseClient,
  companyId: string,
): Promise<{ rows: DashboardPendingRevenueLinkRow[]; error: string | null }> {
  const { data, error } = await client.rpc(
    "dashboard_import_review_pending_revenue_link_list",
    {
      p_company_id: companyId,
    },
  );
  if (error) return { rows: [], error: error.message };
  return { rows: parsePendingRevenueRows(data), error: null };
}

export async function dashboardImportReviewFinalizeRecipeProductSales(
  client: SupabaseClient,
  companyId: string,
  productId: string,
): Promise<{ ok: boolean; migrated_entries?: number; error?: string }> {
  const { data, error } = await client.rpc(
    "dashboard_import_review_finalize_recipe_product_sales",
    {
      p_company_id: companyId,
      p_product_id: productId,
    },
  );
  if (error) return { ok: false, error: error.message };
  const row = data as {
    ok?: boolean;
    migrated_entries?: number;
    error?: string;
    message?: string;
  };
  if (!row?.ok) {
    return {
      ok: false,
      error: row?.message ?? row?.error ?? "Não foi possível migrar as vendas.",
    };
  }
  return { ok: true, migrated_entries: Number(row.migrated_entries ?? 0) };
}

import type { SupabaseClient } from "@supabase/supabase-js";

export type DashboardImportReviewRow = {
  product_id: string;
  name: string;
  unit: string;
  current_quantity: number;
  priority_import?: boolean;
  priority_epoc?: boolean;
};

function parseRows(raw: unknown): DashboardImportReviewRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
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
  const { data, error } = await client.rpc("dashboard_import_review_entry_no_exit_list", {
    p_company_id: companyId,
  });
  if (error) return { rows: [], error: error.message };
  return { rows: parseRows(data), error: null };
}

export async function fetchDashboardImportReviewExitNoEntry(
  client: SupabaseClient,
  companyId: string,
): Promise<{ rows: DashboardImportReviewRow[]; error: string | null }> {
  const { data, error } = await client.rpc("dashboard_import_review_exit_no_entry_list", {
    p_company_id: companyId,
  });
  if (error) return { rows: [], error: error.message };
  return { rows: parseRows(data), error: null };
}

export async function dashboardImportReviewSetResolution(
  client: SupabaseClient,
  params: {
    companyId: string;
    productId: string;
    bucket: "ENTRY_NO_EXIT" | "EXIT_NO_ENTRY";
    resolution: "DISMISSED" | "LINK_RECIPE_STARTED";
  },
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await client.rpc("dashboard_import_review_set_resolution", {
    p_company_id: params.companyId,
    p_product_id: params.productId,
    p_bucket: params.bucket,
    p_resolution: params.resolution,
  });
  if (error) return { ok: false, error: error.message };
  const row = data as { ok?: boolean; error?: string };
  if (!row?.ok) return { ok: false, error: row?.error ?? "Falha ao gravar revisão." };
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
  const { data, error } = await client.rpc("dashboard_import_review_confirm_outbound_as_recipe", {
    p_company_id: companyId,
    p_product_id: productId,
  });
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
      error: row?.message ?? row?.error ?? "Não foi possível concluir a conversão.",
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

function parsePendingRevenueRows(raw: unknown): DashboardPendingRevenueLinkRow[] {
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
        pending_sales_count: Math.max(0, Math.floor(Number(o.pending_sales_count ?? 0))),
      };
    })
    .filter((x): x is DashboardPendingRevenueLinkRow => x != null);
}

export async function fetchDashboardImportReviewPendingRevenueLink(
  client: SupabaseClient,
  companyId: string,
): Promise<{ rows: DashboardPendingRevenueLinkRow[]; error: string | null }> {
  const { data, error } = await client.rpc("dashboard_import_review_pending_revenue_link_list", {
    p_company_id: companyId,
  });
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

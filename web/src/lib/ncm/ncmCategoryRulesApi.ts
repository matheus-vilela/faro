import { normalizeNcm8 } from "@/lib/ncm/normalizeNcm";
import { supabase } from "@/lib/supabase";
import type {
  CompanyNcmProductRow,
  CompanyNcmRow,
} from "@/types/companyNcmCategory";

type ListRpcRow = {
  ncm?: string | null;
  product_count?: number | string | null;
  expense_item_count?: number | string | null;
  sample_product_names?: string[] | null;
  product_category_id?: string | null;
  dre_category_id?: string | null;
};

export async function fetchCompanyNcms(
  companyId: string,
): Promise<CompanyNcmRow[]> {
  const { data, error } = await supabase.rpc("list_company_ncms", {
    p_company_id: companyId,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as ListRpcRow[]).flatMap((row) => {
    const ncm = normalizeNcm8(row.ncm);
    if (!ncm) return [];
    return [
      {
        ncm,
        productCount: Number(row.product_count) || 0,
        expenseItemCount: Number(row.expense_item_count) || 0,
        sampleProductNames: (row.sample_product_names ?? []).filter(Boolean),
        categoryId: String(row.product_category_id ?? "").trim() || null,
        dreCategoryId: String(row.dre_category_id ?? "").trim() || null,
      },
    ];
  });
}

export async function fetchCompanyNcmProducts(
  companyId: string,
  ncm: string,
): Promise<CompanyNcmProductRow[]> {
  const { data, error } = await supabase.rpc("list_company_ncm_products", {
    p_company_id: companyId,
    p_ncm: ncm,
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ id?: string; name?: string; unit?: string | null }>).map(
    (row) => ({
      id: String(row.id ?? ""),
      name: String(row.name ?? "").trim() || "—",
      unit: row.unit != null ? String(row.unit) : null,
    }),
  ).filter((row) => row.id);
}

export async function upsertNcmCategoryRules(input: {
  companyId: string;
  ncms: string[];
  categoryId: string;
}): Promise<void> {
  const ncms = [
    ...new Set(input.ncms.map((n) => normalizeNcm8(n)).filter((n): n is string => Boolean(n))),
  ];
  if (ncms.length === 0) return;
  const { error } = await supabase.from("company_ncm_category_rules").upsert(
    ncms.map((ncm) => ({
      company_id: input.companyId,
      ncm,
      product_category_id: input.categoryId,
    })),
    { onConflict: "company_id,ncm" },
  );
  if (error) throw new Error(error.message);
}

export async function deleteNcmCategoryRules(input: {
  companyId: string;
  ncms: string[];
}): Promise<void> {
  const ncms = [
    ...new Set(input.ncms.map((n) => normalizeNcm8(n)).filter((n): n is string => Boolean(n))),
  ];
  if (ncms.length === 0) return;
  const { error } = await supabase
    .from("company_ncm_category_rules")
    .delete()
    .eq("company_id", input.companyId)
    .in("ncm", ncms);
  if (error) throw new Error(error.message);
}

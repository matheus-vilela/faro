/** Prefill da linha da NF: categoria de compra, senão CMV do cadastro. */

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export function preferredPurchaseCategoryId(row: {
  default_expense_category_id?: string | null;
  cmv_category_id?: string | null;
}): string {
  return (
    String(row.default_expense_category_id ?? "").trim() ||
    String(row.cmv_category_id ?? "").trim()
  );
}

export async function fetchProductDefaultExpenseCategoryById(
  supabase: SupabaseClient,
  companyId: string,
  productIds: Iterable<string>,
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      [...productIds].map((id) => String(id ?? "").trim()).filter(Boolean),
    ),
  ];
  const map = new Map<string, string>();
  if (!companyId || ids.length === 0) return map;

  const { data } = await supabase
    .from("products")
    .select("id, default_expense_category_id, cmv_category_id")
    .eq("company_id", companyId)
    .in("id", ids);

  for (const row of data ?? []) {
    const id = String((row as { id?: string }).id ?? "").trim();
    const cat = preferredPurchaseCategoryId(
      row as {
        default_expense_category_id?: string | null;
        cmv_category_id?: string | null;
      },
    );
    if (id && cat) map.set(id, cat);
  }
  return map;
}

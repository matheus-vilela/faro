/**
 * Vínculo determinístico produto ↔ cProd do fornecedor (`product_supplier_codes`).
 */

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export function normalizeCProd(raw: string | null | undefined): string | null {
  const c = String(raw ?? "").trim();
  return c.length > 0 ? c : null;
}

export async function findProductIdBySupplierCProd(
  supabase: SupabaseClient,
  companyId: string,
  supplierId: string,
  cProd: string,
): Promise<string | null> {
  const code = normalizeCProd(cProd);
  if (!code) return null;
  const { data, error } = await supabase
    .from("product_supplier_codes")
    .select("product_id")
    .eq("company_id", companyId)
    .eq("supplier_id", supplierId)
    .eq("c_prod", code)
    .maybeSingle();
  if (error) {
    console.error(
      "[productSupplierCodes] lookup_err",
      error.message,
    );
    return null;
  }
  return data?.product_id != null ? String(data.product_id) : null;
}

export async function upsertProductSupplierCode(
  supabase: SupabaseClient,
  companyId: string,
  supplierId: string | null | undefined,
  cProd: string | null | undefined,
  productId: string | null | undefined,
): Promise<void> {
  const sid = supplierId != null ? String(supplierId).trim() : "";
  const code = normalizeCProd(cProd);
  const pid = productId != null ? String(productId).trim() : "";
  if (!sid || !code || !pid || pid.startsWith("preview:")) return;

  const { error } = await supabase.from("product_supplier_codes").upsert(
    {
      company_id: companyId,
      supplier_id: sid,
      c_prod: code,
      product_id: pid,
    },
    { onConflict: "company_id,supplier_id,c_prod" },
  );
  if (error) {
    console.error(
      "[productSupplierCodes] upsert_err",
      error.message,
    );
  }
}

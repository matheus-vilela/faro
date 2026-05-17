import { supabase } from "@/lib/supabase";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";

export async function loadProductUnitConversions(
  companyId: string,
  productId: string,
): Promise<{ rows: ProductUnitConversionDraft[]; error: string | null }> {
  const { data, error } = await supabase
    .from("product_unit_conversions")
    .select(
      "id, company_id, product_id, primary_qty, primary_unit_code, secondary_qty, secondary_unit_code",
    )
    .eq("company_id", companyId)
    .eq("product_id", productId)
    .order("secondary_unit_code", { ascending: true });

  if (error) return { rows: [], error: error.message };

  return {
    rows: (data ?? []).map((r) => ({
      id: r.id as string | undefined,
      company_id: String(r.company_id),
      product_id: String(r.product_id),
      primary_qty: Number(r.primary_qty),
      primary_unit_code: String(r.primary_unit_code ?? "").trim(),
      secondary_qty: Number(r.secondary_qty),
      secondary_unit_code: String(r.secondary_unit_code ?? "").trim(),
    })),
    error: null,
  };
}

/** Substitui todas as conversões customizadas do produto (mesmo padrão da ficha em Produtos). */
export async function persistProductUnitConversions(
  companyId: string,
  productId: string,
  conversions: ProductUnitConversionDraft[],
): Promise<{ ok: boolean; error?: string }> {
  const { error: delErr } = await supabase
    .from("product_unit_conversions")
    .delete()
    .eq("product_id", productId);

  if (delErr) return { ok: false, error: delErr.message };

  if (conversions.length === 0) return { ok: true };

  const { error: insErr } = await supabase.from("product_unit_conversions").insert(
    conversions.map((r) => ({
      company_id: companyId,
      product_id: productId,
      primary_qty: r.primary_qty,
      primary_unit_code: r.primary_unit_code,
      secondary_qty: r.secondary_qty,
      secondary_unit_code: r.secondary_unit_code,
    })),
  );

  if (insErr) return { ok: false, error: insErr.message };
  return { ok: true };
}

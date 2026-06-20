import { expandMassVolumeConversionSiblings } from "@/lib/companyUnits/convert";
import {
  parseProductUnitConversionsJson,
  toProductUnitConversionsJson,
} from "@/lib/productUnitConversionsJson";
import { supabase } from "@/lib/supabase";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";

/** Expande kg/g/mg e ml/l antes de gravar no banco. */
export function prepareProductUnitConversionsForPersist(
  hubUnitCode: string,
  conversions: ProductUnitConversionDraft[],
): ProductUnitConversionDraft[] {
  if (conversions.length === 0) return [];
  const hub = hubUnitCode.trim() || conversions[0]!.primary_unit_code.trim();
  const expanded = expandMassVolumeConversionSiblings(
    hub,
    conversions.map((r) => ({
      primary_qty: Number(r.primary_qty),
      primary_unit_code: r.primary_unit_code,
      secondary_qty: Number(r.secondary_qty),
      secondary_unit_code: r.secondary_unit_code,
    })),
  );
  const companyId = conversions[0]!.company_id;
  const productId = conversions[0]!.product_id;
  return expanded.map((r) => ({
    company_id: companyId,
    product_id: productId,
    primary_qty: r.primary_qty,
    primary_unit_code: r.primary_unit_code,
    secondary_qty: r.secondary_qty,
    secondary_unit_code: r.secondary_unit_code,
  }));
}

export async function loadProductUnitConversions(
  companyId: string,
  productId: string,
): Promise<{ rows: ProductUnitConversionDraft[]; error: string | null }> {
  const { data, error } = await supabase
    .from("products")
    .select("unit_conversions")
    .eq("company_id", companyId)
    .eq("id", productId)
    .maybeSingle();

  if (error) return { rows: [], error: error.message };

  return {
    rows: parseProductUnitConversionsJson(
      data?.unit_conversions,
      companyId,
      productId,
    ),
    error: null,
  };
}

/** Substitui todas as conversões customizadas do produto (`products.unit_conversions`). */
export async function persistProductUnitConversions(
  companyId: string,
  productId: string,
  conversions: ProductUnitConversionDraft[],
): Promise<{ ok: boolean; error?: string }> {
  const hub = conversions[0]?.primary_unit_code?.trim() ?? "";
  const toPersist =
    conversions.length > 0
      ? prepareProductUnitConversionsForPersist(hub, conversions)
      : [];

  const { error } = await supabase
    .from("products")
    .update({
      unit_conversions: toProductUnitConversionsJson(toPersist),
    })
    .eq("company_id", companyId)
    .eq("id", productId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

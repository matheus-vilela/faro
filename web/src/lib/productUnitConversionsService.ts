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

function isMissingRowError(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "PGRST116" ||
    /0 rows|multiple \(or no\) rows/i.test(error.message ?? "")
  );
}

export async function loadProductUnitConversionsByIds(
  companyId: string,
  productIds: string[],
): Promise<{
  byId: Record<string, ProductUnitConversionDraft[]>;
  error: string | null;
}> {
  const ids = [
    ...new Set(productIds.map((id) => id.trim()).filter(Boolean)),
  ];
  const byId: Record<string, ProductUnitConversionDraft[]> = {};
  for (const id of ids) byId[id] = [];
  if (ids.length === 0) return { byId, error: null };

  const { data, error } = await supabase
    .from("products")
    .select("id, unit_conversions")
    .eq("company_id", companyId)
    .in("id", ids);

  if (error) {
    if (isMissingRowError(error)) return { byId, error: null };
    return { byId, error: error.message };
  }

  for (const row of data ?? []) {
    const r = row as { id: string; unit_conversions?: unknown };
    if (!r.id) continue;
    byId[r.id] = parseProductUnitConversionsJson(
      r.unit_conversions,
      companyId,
      r.id,
    );
  }
  return { byId, error: null };
}

export async function loadProductUnitConversions(
  companyId: string,
  productId: string,
): Promise<{ rows: ProductUnitConversionDraft[]; error: string | null }> {
  const id = productId.trim();
  if (!companyId.trim() || !id) return { rows: [], error: null };

  const { data, error } = await supabase
    .from("products")
    .select("unit_conversions")
    .eq("company_id", companyId)
    .eq("id", id)
    .limit(1);

  if (error) {
    if (isMissingRowError(error)) return { rows: [], error: null };
    return { rows: [], error: error.message };
  }

  return {
    rows: parseProductUnitConversionsJson(
      data?.[0]?.unit_conversions,
      companyId,
      id,
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

/**
 * Conversões de unidade embutidas em `products.unit_conversions` (JSONB).
 */
// deno-lint-ignore no-explicit-any
type SupabaseAdmin = any;

export type ProductUnitConversionRow = {
  primary_qty: number;
  primary_unit_code: string;
  secondary_qty: number;
  secondary_unit_code: string;
};

export function parseUnitConversionsJson(raw: unknown): ProductUnitConversionRow[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductUnitConversionRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const primary_qty = Number(o.primary_qty);
    const secondary_qty = Number(o.secondary_qty);
    const primary_unit_code = String(o.primary_unit_code ?? "").trim()
      .toLowerCase();
    const secondary_unit_code = String(o.secondary_unit_code ?? "").trim()
      .toLowerCase();
    if (
      !Number.isFinite(primary_qty) ||
      !Number.isFinite(secondary_qty) ||
      primary_qty <= 0 ||
      secondary_qty <= 0 ||
      !primary_unit_code ||
      !secondary_unit_code
    ) {
      continue;
    }
    out.push({
      primary_qty,
      primary_unit_code,
      secondary_qty,
      secondary_unit_code,
    });
  }
  return out;
}

export function buildUnitConversionsJson(
  rows: ProductUnitConversionRow[],
): ProductUnitConversionRow[] {
  return rows.map((r) => ({
    primary_qty: Number(r.primary_qty),
    primary_unit_code: r.primary_unit_code.trim().toLowerCase(),
    secondary_qty: Number(r.secondary_qty),
    secondary_unit_code: r.secondary_unit_code.trim().toLowerCase(),
  }));
}

export async function loadProductUnitConversionsFromProduct(
  admin: SupabaseAdmin,
  productId: string,
): Promise<ProductUnitConversionRow[]> {
  const { data, error } = await admin
    .from("products")
    .select("unit_conversions")
    .eq("id", productId)
    .maybeSingle();
  if (error) {
    console.error("[productUnitConversionsOnProduct] load:", error.message);
    return [];
  }
  return parseUnitConversionsJson(data?.unit_conversions);
}

export async function persistProductUnitConversionsOnProduct(
  admin: SupabaseAdmin,
  productId: string,
  rows: ProductUnitConversionRow[],
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await admin
    .from("products")
    .update({ unit_conversions: buildUnitConversionsJson(rows) })
    .eq("id", productId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function appendProductUnitConversionOnProduct(
  admin: SupabaseAdmin,
  productId: string,
  hubUnit: string,
  row: ProductUnitConversionRow,
): Promise<void> {
  const hub = hubUnit.trim().toLowerCase();
  const sec = row.secondary_unit_code.trim().toLowerCase();
  if (!hub || !sec || hub === sec) return;

  const existing = await loadProductUnitConversionsFromProduct(admin, productId);
  const filtered = existing.filter(
    (r) => r.secondary_unit_code.toLowerCase() !== sec,
  );
  filtered.push({
    primary_qty: Number(row.primary_qty) > 0 ? Number(row.primary_qty) : 1,
    primary_unit_code: hub,
    secondary_qty: Number(row.secondary_qty) > 0 ? Number(row.secondary_qty) : 1,
    secondary_unit_code: sec,
  });
  await persistProductUnitConversionsOnProduct(admin, productId, filtered);
}

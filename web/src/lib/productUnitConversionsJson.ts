import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";

export type ProductUnitConversionJson = {
  primary_qty: number;
  primary_unit_code: string;
  secondary_qty: number;
  secondary_unit_code: string;
};

export function parseProductUnitConversionsJson(
  raw: unknown,
  companyId: string,
  productId: string,
): ProductUnitConversionDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductUnitConversionDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const primary_qty = Number(o.primary_qty);
    const secondary_qty = Number(o.secondary_qty);
    const primary_unit_code = String(o.primary_unit_code ?? "").trim();
    const secondary_unit_code = String(o.secondary_unit_code ?? "").trim();
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
      company_id: companyId,
      product_id: productId,
      primary_qty,
      primary_unit_code,
      secondary_qty,
      secondary_unit_code,
    });
  }
  return out.sort((a, b) =>
    a.secondary_unit_code.localeCompare(b.secondary_unit_code, "pt-BR"),
  );
}

export function toProductUnitConversionsJson(
  rows: Array<{
    primary_qty: number;
    primary_unit_code: string;
    secondary_qty: number;
    secondary_unit_code: string;
  }>,
): ProductUnitConversionJson[] {
  return rows.map((r) => ({
    primary_qty: Number(r.primary_qty),
    primary_unit_code: String(r.primary_unit_code).trim().toLowerCase(),
    secondary_qty: Number(r.secondary_qty),
    secondary_unit_code: String(r.secondary_unit_code).trim().toLowerCase(),
  }));
}

/** Expande `products.unit_conversions` para o formato usado na UI (lista plana). */
export function flattenProductUnitConversionsDrafts(
  companyId: string,
  products: Array<{ id: string; unit_conversions?: unknown }>,
): ProductUnitConversionDraft[] {
  const out: ProductUnitConversionDraft[] = [];
  for (const p of products) {
    out.push(
      ...parseProductUnitConversionsJson(p.unit_conversions, companyId, p.id),
    );
  }
  return out;
}

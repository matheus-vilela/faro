import { defaultProductStockUnitCode } from "@/lib/companyUnits/productUnitOptions";
import { sanitizeCatalogProductName } from "@/lib/productImport/canonicalName";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/product";

export function generateProductSku(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "SKU-";
  const array = new Uint8Array(8);
  crypto.getRandomValues(array);
  for (let i = 0; i < 8; i++) {
    result += chars[array[i]! % chars.length];
  }
  return result;
}

export async function createCatalogProduct(args: {
  companyId: string;
  name: string;
}): Promise<{ product: Product | null; error: string | null }> {
  const catalogName =
    sanitizeCatalogProductName(args.name) || args.name.trim();
  if (!catalogName) {
    return { product: null, error: "Informe o nome do produto." };
  }

  const { data, error } = await supabase
    .from("products")
    .insert({
      company_id: args.companyId,
      name: catalogName,
      sku: generateProductSku(),
      unit: defaultProductStockUnitCode(),
      min_quantity: 0,
      current_quantity: 0,
      composes_cmv: true,
    })
    .select()
    .single();

  if (error || !data) {
    return {
      product: null,
      error: error?.message ?? "Não foi possível cadastrar o produto.",
    };
  }
  return { product: data as Product, error: null };
}

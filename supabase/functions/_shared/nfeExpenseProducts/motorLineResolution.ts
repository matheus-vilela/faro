import type { ItemWithProductMatch } from "../../received-whatsapp-message/productMatch.ts";
import { canonicalProductName } from "../productImport/canonicalName.ts";
import type { ImportItemResolutionStatus } from "../productImport/resolutionStatus.ts";
import type { ExtractedExpenseItem } from "../openaiExpense.ts";
import {
  autoCatalogStockUnitWithOptionalUnPack,
  catalogRegistrationNameFromNfeLine,
  insertProductUnitConversions,
} from "./newProductCatalogFromNfe.ts";
import type { NfeCatalogLineResolution } from "./types.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export function mapResolution(
  pm: NonNullable<ItemWithProductMatch["productMatch"]> | undefined,
  createdNew: boolean,
): NfeCatalogLineResolution {
  if (!pm) return "PENDING_REVIEW";
  if (createdNew) return "NEW_PRODUCT_CREATED";
  const rid = String(pm.resolvedProductId ?? "").trim();
  if (rid) return "AUTO_MATCH";
  if (pm.resolutionStatus === "AUTO_MATCH") return "AUTO_MATCH";
  if (
    pm.resolutionStatus === "NEW_PRODUCT_STAGED" &&
    !pm.needsConfirmation &&
    String(pm.borderlineLlmSuggestedName ?? "").trim() !== ""
  ) {
    return "NEW_PRODUCT_CREATED";
  }
  return "PENDING_REVIEW";
}

export async function ensureProductForLine(
  supabase: SupabaseClient,
  companyId: string,
  item: ExtractedExpenseItem,
  pm: NonNullable<ItemWithProductMatch["productMatch"]>,
): Promise<{ productId: string | null; created: boolean }> {
  const existing = String(pm.resolvedProductId ?? "").trim();
  if (existing) return { productId: existing, created: false };

  const suggestedId = String(pm.suggestedProductId ?? "").trim();
  if (suggestedId && pm.resolutionStatus === "NEW_PRODUCT_STAGED") {
    return { productId: null, created: false };
  }

  const blockStatuses: ImportItemResolutionStatus[] = [
    "UNIT_CONFLICT_PENDING",
    "UNIT_VALIDATION_REQUIRED",
    "PENDING_USER_CONFIRM",
  ];
  if (blockStatuses.includes(pm.resolutionStatus as ImportItemResolutionStatus)) {
    return { productId: null, created: false };
  }

  const name = catalogRegistrationNameFromNfeLine(item, pm);
  if (!name) return { productId: null, created: false };

  const cn = canonicalProductName(name);
  if (cn) {
    const { data: dup } = await supabase
      .from("products")
      .select("id")
      .eq("company_id", companyId)
      .eq("canonical_name", cn)
      .eq("is_active", true)
      .maybeSingle();
    if (dup?.id) return { productId: String(dup.id), created: false };
  }

  const { stockUnit, pack, conversions } = autoCatalogStockUnitWithOptionalUnPack(
    item,
    pm,
  );
  const insertRow: Record<string, unknown> = {
    company_id: companyId,
    name,
    unit: stockUnit,
    ncm: item.ncm ? String(item.ncm).trim() || null : null,
    canonical_name: cn || null,
    min_quantity: 0,
    current_quantity: 0,
    is_active: true,
    stock_control_type: "DIRECT",
  };
  if (pack) {
    insertRow.import_unit_needs_review = false;
    insertRow.import_unit_raw = null;
  }
  const { data: ins, error } = await supabase
    .from("products")
    .insert(insertRow)
    .select("id")
    .single();
  if (error || !ins?.id) {
    console.error("[nfeExpenseMotor] create product:", error?.message ?? "unknown");
    return { productId: null, created: false };
  }
  const pid = String(ins.id);
  if (conversions.length > 0) {
    await insertProductUnitConversions(
      supabase,
      companyId,
      pid,
      conversions,
      "[nfeExpenseMotor]",
    );
  } else if (pack) {
    const { error: cErr } = await supabase.from("product_unit_conversions").insert({
      company_id: companyId,
      product_id: pid,
      primary_qty: 1,
      primary_unit_code: "un",
      secondary_qty: pack.secondary_qty,
      secondary_unit_code: pack.secondary_unit_code,
    });
    if (cErr) {
      console.error("[nfeExpenseMotor] product_unit_conversions:", cErr.message);
    }
  }
  return { productId: pid, created: true };
}

export async function createProductAutoWhenNoReviewQueue(
  supabase: SupabaseClient,
  companyId: string,
  item: ExtractedExpenseItem,
  pm: NonNullable<ItemWithProductMatch["productMatch"]>,
): Promise<{ productId: string | null; created: boolean }> {
  const name = catalogRegistrationNameFromNfeLine(item, pm);
  if (!name) return { productId: null, created: false };

  const { stockUnit, pack, conversions } = autoCatalogStockUnitWithOptionalUnPack(
    item,
    pm,
  );
  const cn = canonicalProductName(name);
  if (cn) {
    const { data: dup } = await supabase
      .from("products")
      .select("id")
      .eq("company_id", companyId)
      .eq("canonical_name", cn)
      .eq("is_active", true)
      .maybeSingle();
    if (dup?.id) return { productId: String(dup.id), created: false };
  }

  const insertRow: Record<string, unknown> = {
    company_id: companyId,
    name,
    unit: stockUnit,
    ncm: item.ncm ? String(item.ncm).trim() || null : null,
    canonical_name: cn || null,
    min_quantity: 0,
    current_quantity: 0,
    is_active: true,
    stock_control_type: "DIRECT",
  };
  if (pack) {
    insertRow.import_unit_needs_review = false;
    insertRow.import_unit_raw = null;
  }
  const { data: ins, error } = await supabase
    .from("products")
    .insert(insertRow)
    .select("id")
    .single();
  if (error || !ins?.id) {
    console.error(
      "[nfeExpenseMotor] createProductAutoWhenNoReviewQueue:",
      error?.message ?? "unknown",
    );
    return { productId: null, created: false };
  }
  const pid = String(ins.id);
  if (conversions.length > 0) {
    await insertProductUnitConversions(
      supabase,
      companyId,
      pid,
      conversions,
      "[nfeExpenseMotor]",
    );
  } else if (pack) {
    const { error: cErr } = await supabase.from("product_unit_conversions").insert({
      company_id: companyId,
      product_id: pid,
      primary_qty: 1,
      primary_unit_code: "un",
      secondary_qty: pack.secondary_qty,
      secondary_unit_code: pack.secondary_unit_code,
    });
    if (cErr) {
      console.error(
        "[nfeExpenseMotor] createProductAutoWhenNoReviewQueue conversions:",
        cErr.message,
      );
    }
  }
  return { productId: pid, created: true };
}

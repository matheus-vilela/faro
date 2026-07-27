import type { ItemWithProductMatch } from "../../received-whatsapp-message/productMatch.ts";
import { createProductWithStockIn } from "../createProductWithStockIn.ts";
import { canonicalProductName } from "../productImport/canonicalName.ts";
import {
  loadSupplierProductMatchHints,
  matchExistingProductFromNfeXmlLine,
} from "../productImport/matchExistingProductFromNfeXml.ts";
import { invoiceLabelMatchesMergedCatalog } from "../productImport/mergedCatalogMatch.ts";
import { normalizeCProd } from "../productImport/productSupplierCodes.ts";
import type { ImportItemResolutionStatus } from "../productImport/resolutionStatus.ts";
import type { ExtractedExpenseItem } from "../openaiExpense.ts";
import {
  autoCatalogStockUnitWithOptionalUnPack,
  catalogRegistrationNameFromNfeLine,
} from "./newProductCatalogFromNfe.ts";
import type { NfeCatalogLineResolution } from "./types.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

/** Evita duplicar cadastro quando o nome bate com canonical_name ou alias de merge. */
export async function findExistingProductIdForCatalogName(
  supabase: SupabaseClient,
  companyId: string,
  catalogName: string,
): Promise<string | null> {
  const cn = canonicalProductName(catalogName);
  if (cn) {
    const { data: dup } = await supabase
      .from("products")
      .select("id")
      .eq("company_id", companyId)
      .eq("canonical_name", cn)
      .eq("is_active", true)
      .maybeSingle();
    if (dup?.id) return String(dup.id);
  }

  const { data: rows, error } = await supabase
    .from("products")
    .select("id, merged_catalog_names")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .not("merged_catalog_names", "eq", "{}");

  if (error) {
    console.error("[nfeExpenseMotor] merged catalog lookup:", error.message);
    return null;
  }

  for (const row of rows ?? []) {
    const merged = row.merged_catalog_names as string[] | null;
    if (invoiceLabelMatchesMergedCatalog(catalogName, merged)) {
      return String(row.id);
    }
  }
  return null;
}

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

function stockQtyAndUnitValueForMotorLine(
  item: ExtractedExpenseItem,
  pm: NonNullable<ItemWithProductMatch["productMatch"]>,
): { quantity: number; unitValue: number } {
  const qty =
    pm.stockQuantity != null && Number(pm.stockQuantity) > 0
      ? Number(pm.stockQuantity)
      : Math.max(0, Number(item.quantity) || 0);
  const unitValue = Math.round((Number(item.unitValue) || 0) * 100) / 100;
  return { quantity: qty, unitValue };
}

async function insertMotorProductWithStock(
  supabase: SupabaseClient,
  companyId: string,
  item: ExtractedExpenseItem,
  pm: NonNullable<ItemWithProductMatch["productMatch"]>,
  logTag: string,
  supplierId?: string | null,
): Promise<{ productId: string | null; created: boolean; stockApplied: boolean }> {
  const name = catalogRegistrationNameFromNfeLine(item, pm);
  if (!name) return { productId: null, created: false, stockApplied: false };

  const { data: catalogRows } = await supabase
    .from("products")
    .select(
      "id, name, unit, barcode, ean, ncm, sku, canonical_name, merged_catalog_names, is_active",
    )
    .eq("company_id", companyId)
    .eq("is_active", true)
    .limit(8000);
  const catalog = Array.isArray(catalogRows) ? catalogRows : [];
  const supplierHints = await loadSupplierProductMatchHints(
    supabase,
    companyId,
    supplierId,
  );
  const xmlMatch = await matchExistingProductFromNfeXmlLine({
    supabase,
    companyId,
    supplierId,
    supplierHints,
    catalog,
    line: {
      nome: String(item.productName ?? name),
      codigo: normalizeCProd(item.productCode),
      ean: item.ean ?? null,
      ncm: item.ncm ?? null,
      unidade_comercial: item.unitCommercial ?? null,
      unidade_tributavel: item.unitTax ?? null,
      quantidade_comercial: item.quantityCommercial ?? item.quantity,
      quantidade_tributavel: item.quantityTax ?? null,
      quantidade: item.quantity,
    },
  });
  if (xmlMatch?.productId) {
    return {
      productId: xmlMatch.productId,
      created: false,
      stockApplied: false,
    };
  }

  const existingId = await findExistingProductIdForCatalogName(
    supabase,
    companyId,
    name,
  );
  if (existingId) {
    return { productId: existingId, created: false, stockApplied: false };
  }

  const { quantity, unitValue } = stockQtyAndUnitValueForMotorLine(item, pm);
  if (quantity <= 0) {
    console.error(logTag, "produto_skip_sem_movimentacao", {
      nome: name,
      quantity: item.quantity,
    });
    return { productId: null, created: false, stockApplied: false };
  }

  const cn = canonicalProductName(name);
  const { stockUnit, pack, conversions } = autoCatalogStockUnitWithOptionalUnPack(
    item,
    pm,
  );
  const insertRow: Record<string, unknown> = {
    name,
    unit: stockUnit,
    ncm: item.ncm ? String(item.ncm).trim() || null : null,
    ean: item.ean ? String(item.ean).replace(/\D/g, "") || null : null,
    canonical_name: cn || null,
    min_quantity: 0,
    is_active: true,
    stock_control_type: "DIRECT",
  };
  if (pack) {
    insertRow.import_unit_needs_review = false;
    insertRow.import_unit_raw = null;
  }

  const unitConversions =
    conversions.length > 0
      ? conversions
      : pack
        ? [
            {
              primary_qty: 1,
              primary_unit_code: stockUnit,
              secondary_qty: pack.secondary_qty,
              secondary_unit_code: pack.secondary_unit_code,
            },
          ]
        : [];

  const created = await createProductWithStockIn(supabase, {
    companyId,
    product: insertRow,
    quantity,
    unitValue,
    referenceType: "nfe_motor_create",
    unitConversions,
  });
  if (created.error || !created.productId) {
    console.error(logTag, "create product+stock:", created.error ?? "unknown");
    return { productId: null, created: false, stockApplied: false };
  }
  if (pack) {
    await supabase
      .from("products")
      .update({
        import_unit_needs_review: false,
        import_unit_raw: null,
      })
      .eq("id", created.productId)
      .eq("company_id", companyId);
  }
  return {
    productId: created.productId,
    created: true,
    stockApplied: true,
  };
}

export async function ensureProductForLine(
  supabase: SupabaseClient,
  companyId: string,
  item: ExtractedExpenseItem,
  pm: NonNullable<ItemWithProductMatch["productMatch"]>,
  supplierId?: string | null,
): Promise<{ productId: string | null; created: boolean; stockApplied: boolean }> {
  const existing = String(pm.resolvedProductId ?? "").trim();
  if (existing) {
    return { productId: existing, created: false, stockApplied: false };
  }

  const suggestedId = String(pm.suggestedProductId ?? "").trim();
  if (suggestedId && pm.resolutionStatus === "NEW_PRODUCT_STAGED") {
    return { productId: null, created: false, stockApplied: false };
  }

  const blockStatuses: ImportItemResolutionStatus[] = [
    "UNIT_CONFLICT_PENDING",
    "UNIT_VALIDATION_REQUIRED",
    "PENDING_USER_CONFIRM",
  ];
  if (blockStatuses.includes(pm.resolutionStatus as ImportItemResolutionStatus)) {
    return { productId: null, created: false, stockApplied: false };
  }

  return insertMotorProductWithStock(
    supabase,
    companyId,
    item,
    pm,
    "[nfeExpenseMotor]",
    supplierId,
  );
}

export async function createProductAutoWhenNoReviewQueue(
  supabase: SupabaseClient,
  companyId: string,
  item: ExtractedExpenseItem,
  pm: NonNullable<ItemWithProductMatch["productMatch"]>,
  supplierId?: string | null,
): Promise<{ productId: string | null; created: boolean; stockApplied: boolean }> {
  return insertMotorProductWithStock(
    supabase,
    companyId,
    item,
    pm,
    "[nfeExpenseMotor] createProductAutoWhenNoReviewQueue",
    supplierId,
  );
}

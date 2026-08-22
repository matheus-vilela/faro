import { convertQuantityForProduct } from "@/lib/companyUnits/convert";
import { parsePendingNewProduct } from "@/lib/expenseItemVinculo";
import {
  canonicalProductName,
  normalizeInvoiceProductLabel,
  sanitizeCatalogProductName,
} from "@/lib/productImport/canonicalName";
import { roundHubQuantityForStock } from "@/lib/productQuantityInput";
import { resolvePrefillCompanyCategoryId } from "@/lib/dre/rateioBoletoByItems";
import { toProductUnitConversionsJson } from "@/lib/productUnitConversionsJson";
import {
  persistProductUnitConversions,
  prepareProductUnitConversionsForPersist,
} from "@/lib/productUnitConversionsService";
import { supabase } from "@/lib/supabase";
import type { ExpenseItem, PendingNewProductMeta } from "@/types/expense";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";

export type ExpenseItemLinkEditMode = "none" | "link" | "create";

export type ExpenseItemLinkEditDraft = {
  mode: ExpenseItemLinkEditMode;
  productId: string | null;
  newProductName: string;
  newProductUnit: string;
  invoiceUnit: string | null;
  quantity: number;
  unitValue: number;
  conversions: ProductUnitConversionDraft[];
  /** Categoria financeira desta linha. */
  companyCategoryId: string | null;
  /** Grupos de mercadoria do produto (tags). */
  productCategoryIds: string[];
};

export function mergeExpenseItemMetadata(
  existing: ExpenseItem["metadata_json"],
  pending: PendingNewProductMeta | null,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(existing ?? {}) };
  if (pending) next.pending_new_product = pending;
  else delete next.pending_new_product;
  return next;
}

export function draftToPendingNewProduct(
  draft: ExpenseItemLinkEditDraft,
): PendingNewProductMeta {
  const name =
    draft.newProductName.trim() ||
    "Produto";
  const unit = (draft.newProductUnit.trim() || "un").toLowerCase();
  return {
    name,
    unit,
    conversions: draft.conversions.map((c) => ({
      primary_qty: Number(c.primary_qty),
      primary_unit_code: String(c.primary_unit_code).trim().toLowerCase(),
      secondary_qty: Number(c.secondary_qty),
      secondary_unit_code: String(c.secondary_unit_code).trim().toLowerCase(),
    })),
    canonical_name: canonicalProductName(name) || null,
  };
}

export function expenseItemDraftSignature(
  draft: ExpenseItemLinkEditDraft,
): string {
  return JSON.stringify({
    mode: draft.mode,
    productId: draft.productId,
    newProductName: draft.newProductName.trim(),
    newProductUnit: draft.newProductUnit.trim().toLowerCase(),
    invoiceUnit: (draft.invoiceUnit ?? "").trim().toLowerCase(),
    quantity: Number(draft.quantity),
    unitValue: Number(draft.unitValue),
    companyCategoryId: draft.companyCategoryId ?? null,
    productCategoryIds: [...draft.productCategoryIds].sort(),
    conversions: draft.conversions.map((c) => [
      Number(c.primary_qty),
      String(c.primary_unit_code).trim().toLowerCase(),
      Number(c.secondary_qty),
      String(c.secondary_unit_code).trim().toLowerCase(),
    ]),
  });
}

export function isExpenseItemDraftDirty(
  draft: ExpenseItemLinkEditDraft,
  pristine: ExpenseItemLinkEditDraft,
): boolean {
  return expenseItemDraftSignature(draft) !== expenseItemDraftSignature(pristine);
}

export function stockQuantityForDraft(
  qty: number,
  invoiceUnit: string | null,
  hubUnit: string,
  conversions: ProductUnitConversionDraft[],
): number | null {
  const from = (invoiceUnit ?? "").trim() || hubUnit;
  const convs = conversions.map((r) => ({
    primary_unit_code: r.primary_unit_code,
    secondary_unit_code: r.secondary_unit_code,
    primary_qty: Number(r.primary_qty),
    secondary_qty: Number(r.secondary_qty),
  }));
  const raw = convertQuantityForProduct(qty, from, hubUnit, hubUnit, convs);
  return raw == null ? null : roundHubQuantityForStock(raw);
}

function expenseItemStockQty(it: {
  quantity: number;
  stock_quantity?: number | null;
}): number {
  const sq = it.stock_quantity;
  if (sq != null && Number(sq) > 0) return Number(sq);
  return Number(it.quantity);
}

async function reverseExpenseItemStock(it: {
  id?: string;
  product_id?: string | null;
  stock_added?: boolean;
  quantity: number;
  stock_quantity?: number | null;
}): Promise<void> {
  if (!it.product_id) return;
  await supabase.rpc("adjust_product_stock", {
    p_product_id: it.product_id,
    p_delta: -expenseItemStockQty(it),
    p_type: "out",
    p_reference_type: "expense_item",
    p_reference_id: it.id ?? null,
  });
}

async function applyExpenseItemStockIn(it: {
  id?: string;
  product_id?: string | null;
  quantity: number;
  stock_quantity?: number | null;
  unit_value?: number;
}): Promise<void> {
  if (!it.product_id) return;
  const delta = expenseItemStockQty(it);
  if (delta <= 0) return;
  await supabase.rpc("adjust_product_stock", {
    p_product_id: it.product_id,
    p_delta: delta,
    p_type: "in",
    p_reference_type: "expense_item",
    p_reference_id: it.id ?? null,
    p_unit_value:
      it.unit_value != null && Number(it.unit_value) >= 0
        ? Number(it.unit_value)
        : null,
  });
}

async function persistProductCategoryAssignments(
  companyId: string,
  productId: string,
  categoryIds: string[],
): Promise<{ error?: string }> {
  const unique = [...new Set(categoryIds.map((id) => id.trim()).filter(Boolean))];
  const { error: delErr } = await supabase
    .from("product_category_assignments")
    .delete()
    .eq("company_id", companyId)
    .eq("product_id", productId);
  if (delErr) return { error: delErr.message };
  if (unique.length === 0) return {};
  const { error: insErr } = await supabase
    .from("product_category_assignments")
    .insert(
      unique.map((category_id) => ({
        company_id: companyId,
        product_id: productId,
        category_id,
      })),
    );
  if (insErr) return { error: insErr.message };
  return {};
}

async function upsertInvoiceAlias(
  companyId: string,
  productName: string,
  productId: string,
): Promise<void> {
  const nl = normalizeInvoiceProductLabel(productName);
  if (!nl) return;
  const { error } = await supabase.from("product_invoice_line_aliases").upsert(
    {
      company_id: companyId,
      normalized_label: nl,
      product_id: productId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id,normalized_label" },
  );
  if (error) {
    console.warn("[saveExpenseItemLinkEdit] alias upsert:", error.message);
  }
}

async function loadCategoryTipo(
  companyId: string,
  categoryId: string | null,
): Promise<string | null> {
  const id = categoryId?.trim();
  if (!id) return null;
  const { data } = await supabase
    .from("company_categories")
    .select("tipo")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  return (data as { tipo?: string } | null)?.tipo ?? null;
}

function productCategoryMemoryPatch(
  categoryId: string,
  tipo: string | null,
): { default_expense_category_id: string; cmv_category_id?: string } {
  return {
    default_expense_category_id: categoryId,
    ...(tipo === "CMV" ? { cmv_category_id: categoryId } : {}),
  };
}

async function createCatalogProduct(args: {
  companyId: string;
  pending: PendingNewProductMeta;
  unitValue: number;
  invoiceUnit: string | null;
  defaultExpenseCategoryId: string | null;
  categoryTipo: string | null;
}): Promise<{ product: Product } | { error: string }> {
  const catalogName =
    sanitizeCatalogProductName(args.pending.name) || args.pending.name;
  const unit = args.pending.unit || "un";
  const drafts: ProductUnitConversionDraft[] = args.pending.conversions.map(
    (c) => ({
      company_id: args.companyId,
      primary_qty: c.primary_qty,
      primary_unit_code: c.primary_unit_code,
      secondary_qty: c.secondary_qty,
      secondary_unit_code: c.secondary_unit_code,
    }),
  );
  const toPersist =
    drafts.length > 0
      ? prepareProductUnitConversionsForPersist(unit, drafts)
      : [];
  const sameUnit =
    (args.invoiceUnit ?? unit).trim().toLowerCase() === unit.toLowerCase();
  const { data, error } = await supabase
    .from("products")
    .insert({
      company_id: args.companyId,
      name: catalogName,
      unit,
      min_quantity: 0,
      current_quantity: 0,
      canonical_name:
        args.pending.canonical_name ??
        (canonicalProductName(catalogName) || null),
      ncm: args.pending.ncm ?? null,
      ...(args.defaultExpenseCategoryId
        ? productCategoryMemoryPatch(
            args.defaultExpenseCategoryId,
            args.categoryTipo,
          )
        : {}),
      unit_conversions: toProductUnitConversionsJson(toPersist),
      ...(sameUnit && args.unitValue >= 0
        ? {
            last_unit_value: args.unitValue,
            last_unit_value_unit_code: unit,
            last_unit_value_stock: args.unitValue,
            average_cost: args.unitValue,
          }
        : {}),
    })
    .select()
    .single();
  if (error || !data) {
    return { error: error?.message ?? "Não foi possível criar o produto" };
  }
  return { product: data as Product };
}

export async function saveExpenseItemLinkEdit(args: {
  companyId: string;
  item: ExpenseItem;
  draft: ExpenseItemLinkEditDraft;
  deferProductCreation: boolean;
}): Promise<{ error?: string; createdProduct?: Product }> {
  if (!args.item.id) return { error: "Item inválido" };

  let productId: string | null = null;
  let importStatus: string | null = args.item.import_resolution_status ?? null;
  let pending: PendingNewProductMeta | null = null;
  let createdProduct: Product | undefined;
  let hubUnit = "un";
  let conversions = args.draft.conversions;
  const categoryTipo = args.draft.companyCategoryId
    ? await loadCategoryTipo(args.companyId, args.draft.companyCategoryId)
    : null;

  if (args.draft.mode === "create") {
    pending = draftToPendingNewProduct(args.draft);
    hubUnit = pending.unit;
    if (args.deferProductCreation) {
      importStatus = "NEW_PRODUCT_STAGED";
      productId = null;
    } else {
      const created = await createCatalogProduct({
        companyId: args.companyId,
        pending,
        unitValue: args.draft.unitValue,
        invoiceUnit: args.draft.invoiceUnit,
        defaultExpenseCategoryId: args.draft.companyCategoryId,
        categoryTipo,
      });
      if ("error" in created) return created;
      productId = created.product.id;
      createdProduct = created.product;
      importStatus = "NEW_PRODUCT_CREATED";
      pending = null;
      conversions = parseProductConversionsFromCreated(
        args.companyId,
        created.product,
      );
    }
  } else if (args.draft.mode === "link" && args.draft.productId) {
    productId = args.draft.productId;
    importStatus = "USER_CONFIRMED_MATCH";
    pending = null;
    const product = await loadProductUnit(args.companyId, productId);
    hubUnit = product?.unit ?? "un";
    if (args.draft.conversions.length > 0) {
      const persist = await persistProductUnitConversions(
        args.companyId,
        productId,
        args.draft.conversions.map((c) => ({
          ...c,
          company_id: args.companyId,
          product_id: productId!,
        })),
      );
      if (!persist.ok) {
        return { error: persist.error ?? "Não foi possível salvar conversões" };
      }
    }
  } else {
    productId = null;
    importStatus = args.item.import_resolution_status === "NEW_PRODUCT_STAGED"
      ? null
      : args.item.import_resolution_status ?? null;
    if (importStatus === "NEW_PRODUCT_CREATED" || importStatus === "USER_CONFIRMED_MATCH") {
      importStatus = "PENDING_USER_CONFIRM";
    }
    pending = null;
  }

  const stockQuantity =
    productId || args.draft.mode === "create"
      ? stockQuantityForDraft(
          args.draft.quantity,
          args.draft.invoiceUnit,
          hubUnit,
          conversions,
        )
      : null;

  const oldPid = args.item.product_id ?? null;
  const hadStock = !!(oldPid && args.item.stock_added);
  const productChanged = oldPid !== productId;
  const qtyChanged =
    Number(args.item.quantity) !== Number(args.draft.quantity) ||
    Number(args.item.stock_quantity ?? 0) !== Number(stockQuantity ?? 0);

  if (hadStock && (productChanged || qtyChanged)) {
    await reverseExpenseItemStock({
      id: args.item.id,
      product_id: oldPid,
      stock_added: true,
      quantity: Number(args.item.quantity),
      stock_quantity: args.item.stock_quantity ?? undefined,
    });
  }

  const { error } = await supabase
    .from("expense_items")
    .update({
      product_id: productId,
      quantity: args.draft.quantity,
      unit_value: args.draft.unitValue,
      invoice_unit: args.draft.invoiceUnit,
      stock_quantity: stockQuantity,
      import_resolution_status: importStatus,
      import_pending_resolution: false,
      metadata_json: mergeExpenseItemMetadata(args.item.metadata_json, pending),
      stock_added: !!(productId && hadStock),
      company_category_id: args.draft.companyCategoryId || null,
    })
    .eq("id", args.item.id);

  if (error) return { error: error.message };

  if (hadStock && productId && (productChanged || qtyChanged)) {
    await applyExpenseItemStockIn({
      id: args.item.id,
      product_id: productId,
      quantity: args.draft.quantity,
      stock_quantity: stockQuantity,
      unit_value: args.draft.unitValue,
    });
  }

  if (productId) {
    await upsertInvoiceAlias(
      args.companyId,
      args.item.product_name,
      productId,
    );
    if (args.draft.companyCategoryId) {
      await supabase
        .from("products")
        .update(
          productCategoryMemoryPatch(
            args.draft.companyCategoryId,
            categoryTipo,
          ),
        )
        .eq("id", productId)
        .eq("company_id", args.companyId);
    }
    const groups = await persistProductCategoryAssignments(
      args.companyId,
      productId,
      args.draft.productCategoryIds,
    );
    if (groups.error) return { error: groups.error, createdProduct };
  }

  return { createdProduct };
}

function parseProductConversionsFromCreated(
  companyId: string,
  product: Product,
): ProductUnitConversionDraft[] {
  const raw = product.unit_conversions;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const o = item as Record<string, unknown>;
    return [
      {
        company_id: companyId,
        product_id: product.id,
        primary_qty: Number(o.primary_qty),
        primary_unit_code: String(o.primary_unit_code ?? ""),
        secondary_qty: Number(o.secondary_qty),
        secondary_unit_code: String(o.secondary_unit_code ?? ""),
      },
    ];
  });
}

async function loadProductUnit(
  companyId: string,
  productId: string,
): Promise<{ unit: string } | null> {
  const { data } = await supabase
    .from("products")
    .select("unit")
    .eq("company_id", companyId)
    .eq("id", productId)
    .maybeSingle();
  if (!data) return null;
  return { unit: String((data as { unit?: string }).unit ?? "un") };
}

export function initialDraftFromItem(
  item: ExpenseItem,
  companyId: string,
  opts?: {
    productDefaultCategoryId?: string | null;
    productCmvCategoryId?: string | null;
    productCategoryIds?: string[];
  },
): ExpenseItemLinkEditDraft {
  const companyCategoryId = resolvePrefillCompanyCategoryId({
    itemCategoryId: item.company_category_id,
    productDefaultCategoryId: opts?.productDefaultCategoryId,
    productCmvCategoryId: opts?.productCmvCategoryId,
  });
  const productCategoryIds = opts?.productCategoryIds ?? [];
  const pending = parsePendingNewProduct(item.metadata_json);
  if (pending && !item.product_id) {
    return {
      mode: "create",
      productId: null,
      newProductName: pending.name,
      newProductUnit: pending.unit,
      invoiceUnit: item.invoice_unit ?? pending.unit,
      quantity: Number(item.quantity),
      unitValue: Number(item.unit_value),
      conversions: pending.conversions.map((c) => ({
        company_id: companyId,
        primary_qty: c.primary_qty,
        primary_unit_code: c.primary_unit_code,
        secondary_qty: c.secondary_qty,
        secondary_unit_code: c.secondary_unit_code,
      })),
      companyCategoryId,
      productCategoryIds,
    };
  }
  if (item.product_id) {
    return {
      mode: "link",
      productId: item.product_id,
      newProductName: item.product_name,
      newProductUnit: item.invoice_unit ?? "un",
      invoiceUnit: item.invoice_unit ?? null,
      quantity: Number(item.quantity),
      unitValue: Number(item.unit_value),
      conversions: [],
      companyCategoryId,
      productCategoryIds,
    };
  }
  return {
    mode: "none",
    productId: null,
    newProductName: item.product_name,
    newProductUnit: (item.invoice_unit ?? "un").toLowerCase() || "un",
    invoiceUnit: item.invoice_unit ?? null,
    quantity: Number(item.quantity),
    unitValue: Number(item.unit_value),
    conversions: [],
    companyCategoryId,
    productCategoryIds,
  };
}

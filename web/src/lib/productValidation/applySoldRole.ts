import {
  dashboardImportReviewEpocRecipeRevertToProduct,
  dashboardImportReviewSetResolution,
} from "@/lib/dashboardImportReview";
import {
  fetchSaleFamilyCandidates,
  linkSaleFamilyVariant,
  promoteProductToSaleFamily,
} from "@/lib/productSaleFamily";
import { ensureSaleFamilyProductId } from "@/lib/resolveSaleFamilyTarget";
import type { ProductSetupItem } from "@/lib/productSetupQueue";
import type { SupabaseClient } from "@supabase/supabase-js";

function soldReviewBucket(
  sold: ProductSetupItem,
): "ENTRY_NO_EXIT" | "EXIT_NO_ENTRY" | "RECIPE_NO_INGREDIENTS" {
  if (sold.kind === "purchase_unlinked") return "ENTRY_NO_EXIT";
  if (sold.kind === "recipe_without_ingredients") return "RECIPE_NO_INGREDIENTS";
  return "EXIT_NO_ENTRY";
}

async function revertSoldRecipeIfNeeded(
  client: SupabaseClient,
  companyId: string,
  sold: ProductSetupItem,
): Promise<{ ok: boolean; error?: string }> {
  if (!sold.recipeId) return { ok: true };
  return dashboardImportReviewEpocRecipeRevertToProduct(
    client,
    companyId,
    sold.productId,
  );
}

async function dismissQueueItem(
  client: SupabaseClient,
  companyId: string,
  item: ProductSetupItem,
): Promise<{ ok: boolean; error?: string }> {
  return dashboardImportReviewSetResolution(client, {
    companyId,
    productId: item.productId,
    bucket: soldReviewBucket(item),
    resolution: "DISMISSED",
  });
}

export async function applySoldAsProduct(
  client: SupabaseClient,
  companyId: string,
  sold: ProductSetupItem,
): Promise<{ ok: boolean; error?: string }> {
  if (sold.recipeId) {
    return revertSoldRecipeIfNeeded(client, companyId, sold);
  }
  return dismissQueueItem(client, companyId, sold);
}

export async function applySoldAsGrouping(
  client: SupabaseClient,
  companyId: string,
  sold: ProductSetupItem,
  variantPurchases: ProductSetupItem[],
): Promise<{ ok: boolean; error?: string }> {
  const reverted = await revertSoldRecipeIfNeeded(client, companyId, sold);
  if (!reverted.ok) return reverted;
  try {
    await promoteProductToSaleFamily(sold.productId);
    for (const purchase of variantPurchases) {
      await linkSaleFamilyVariant({
        companyId,
        familyProductId: sold.productId,
        variantName: purchase.name,
        variantSku: purchase.sku,
        variantUnit: purchase.unit !== "—" ? purchase.unit : "un",
        qtyPerSale: 1,
        variantProductId: purchase.productId,
      });
      const dismissed = await dashboardImportReviewSetResolution(client, {
        companyId,
        productId: purchase.productId,
        bucket: "ENTRY_NO_EXIT",
        resolution: "DISMISSED",
      });
      if (!dismissed.ok) return dismissed;
    }
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error ? e.message : "Não foi possível tornar agrupamento.",
    };
  }
  return dismissQueueItem(client, companyId, sold);
}

export async function applySoldAsVariant(
  client: SupabaseClient,
  companyId: string,
  sold: ProductSetupItem,
  familyProductId: string,
  newFamilyName = "",
): Promise<{ ok: boolean; error?: string }> {
  const reverted = await revertSoldRecipeIfNeeded(client, companyId, sold);
  if (!reverted.ok) return reverted;
  try {
    const candidates = await fetchSaleFamilyCandidates(companyId, []);
    const family = await ensureSaleFamilyProductId({
      companyId,
      familyProductId,
      newFamilyName,
      existing: candidates.filter((row) => row.id !== sold.productId),
    });
    if (!family.ok) return family;
    await linkSaleFamilyVariant({
      companyId,
      familyProductId: family.id,
      variantName: sold.name,
      variantSku: sold.sku,
      variantUnit: sold.unit !== "—" ? sold.unit : "un",
      qtyPerSale: 1,
      variantProductId: sold.productId,
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Não foi possível vincular.",
    };
  }
  return dismissQueueItem(client, companyId, sold);
}

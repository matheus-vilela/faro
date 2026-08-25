import { suggestOperationalItemTypeFromName } from "@/lib/itemClassification/suggestOperationalItemType";
import { suggestMasterRecipeTemplate } from "@/lib/masterRecipeCatalog/suggestMasterRecipeTemplate";
import {
  scoreEpocToNfeName,
  scoreHintToPurchaseName,
} from "@/lib/productValidation/nameMatch";
import { componentHintsForSold } from "@/lib/productValidation/recipeIngredientHints";
import type { ProductSetupItem, ProductSetupQueue } from "@/lib/productSetupQueue";
import {
  VALIDATION_HIGH_MIN,
  VALIDATION_INGREDIENT_MIN,
  VALIDATION_RECIPE_ROLE_MIN,
  VALIDATION_REVIEW_MIN,
  type ProductValidationResult,
  type RecipeIngredientCandidate,
  type RecipeSuggestion,
  type SameItemSuggestion,
  type ValidationBand,
  type ValidationPurchaseCandidate,
} from "@/lib/productValidation/types";

function bandForScore(score: number): ValidationBand {
  return score >= VALIDATION_HIGH_MIN ? "high" : "review";
}

function isSoldSide(item: ProductSetupItem): boolean {
  return (
    item.kind === "sold_unlinked" || item.kind === "recipe_without_ingredients"
  );
}

function isPurchaseSide(item: ProductSetupItem): boolean {
  return item.kind === "purchase_unlinked";
}

export type SoldRole = {
  item: ProductSetupItem;
  isRecipe: boolean;
  roleConfidence: number;
  summaryPt: string;
  masterRecipeName: string | null;
  masterRecipeId: string | null;
};

export function classifySoldRole(item: ProductSetupItem): SoldRole {
  const forced = item.kind === "recipe_without_ingredients";
  const type = suggestOperationalItemTypeFromName({ name: item.name });
  const master = suggestMasterRecipeTemplate(item.name);
  const recipeFromType =
    type.suggested_type === "RECEITA_FICHA" &&
    type.suggested_score >= VALIDATION_RECIPE_ROLE_MIN;
  const isRecipe = forced || recipeFromType || Boolean(master);
  const roleConfidence = forced
    ? Math.max(0.78, type.suggested_score)
    : master
      ? Math.max(type.suggested_score, master.score)
      : type.suggested_score;
  const summaryPt =
    master?.explanationPt ??
    type.suggestion_reasons.summary_pt ??
    (isRecipe
      ? "O nome do PDV parece um prato ou drink, não um item de nota."
      : "O nome do PDV parece um item que também entra na nota.");
  return {
    item,
    isRecipe,
    roleConfidence,
    summaryPt,
    masterRecipeName: master?.canonicalName ?? null,
    masterRecipeId: master?.masterRecipeId ?? null,
  };
}

function rankPurchasesForSold(
  sold: ProductSetupItem,
  purchases: ProductSetupItem[],
): ValidationPurchaseCandidate[] {
  const ranked: ValidationPurchaseCandidate[] = [];
  for (const purchase of purchases) {
    const { score, reasons } = scoreEpocToNfeName(sold.name, purchase.name);
    if (score < VALIDATION_REVIEW_MIN) continue;
    ranked.push({ purchase, score, reasons });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, 3);
}

function rankIngredientsForSold(
  role: SoldRole,
  purchases: ProductSetupItem[],
): RecipeIngredientCandidate[] {
  const hints = componentHintsForSold(role.item.name, role.masterRecipeId);
  if (!hints.length) return [];

  const used = new Set<string>();
  const out: RecipeIngredientCandidate[] = [];

  for (const hint of hints) {
    let best: RecipeIngredientCandidate | null = null;
    for (const purchase of purchases) {
      if (used.has(purchase.productId)) continue;
      let local: { score: number; reasons: string[] } = {
        score: 0,
        reasons: [],
      };
      for (const matchName of hint.matchNames) {
        const next = scoreHintToPurchaseName(matchName, purchase.name);
        if (next.score > local.score) local = next;
      }
      if (local.score < VALIDATION_INGREDIENT_MIN) continue;
      const candidate: RecipeIngredientCandidate = {
        purchase,
        hintKey: hint.key,
        hintLabel: hint.label,
        score: local.score,
        reasons:
          local.reasons.length > 0
            ? local.reasons
            : [`Compra alinhada ao insumo típico “${hint.label}”`],
      };
      if (!best || candidate.score > best.score) best = candidate;
    }
    if (best) {
      used.add(best.purchase.productId);
      out.push(best);
    }
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * Interpreta a fila de correlação: só cruza PDV/EPOC × nota, só por nome.
 * Nada é aplicado — o resultado é sugestão para o usuário confirmar.
 */
export function runProductValidation(
  queue: Pick<ProductSetupQueue, "items">,
): ProductValidationResult {
  const purchases = queue.items.filter(isPurchaseSide);
  const solds = queue.items.filter(isSoldSide);
  const leftover = queue.items.filter(
    (item) => !isPurchaseSide(item) && !isSoldSide(item),
  );

  const roles = solds.map(classifySoldRole);
  const rankedBySold = new Map<string, ValidationPurchaseCandidate[]>();
  for (const role of roles) {
    rankedBySold.set(role.item.key, rankPurchasesForSold(role.item, purchases));
  }

  const usedPurchaseIds = new Set<string>();
  const sameItem: SameItemSuggestion[] = [];

  const sameItemOrder = [...roles].sort((a, b) => {
    const as = rankedBySold.get(a.item.key)?.[0]?.score ?? 0;
    const bs = rankedBySold.get(b.item.key)?.[0]?.score ?? 0;
    return bs - as;
  });

  for (const role of sameItemOrder) {
    const allCandidates = rankedBySold.get(role.item.key) ?? [];
    const available = allCandidates.filter(
      (c) => !usedPurchaseIds.has(c.purchase.productId),
    );
    const best = available[0];
    if (!best) continue;

    const conflictWithRecipe = role.isRecipe && best.score >= VALIDATION_HIGH_MIN;
    if (role.isRecipe && !conflictWithRecipe) continue;

    usedPurchaseIds.add(best.purchase.productId);
    sameItem.push({
      id: `same:${role.item.key}`,
      sold: role.item,
      candidates: available,
      band: conflictWithRecipe ? "review" : bandForScore(best.score),
      conflictWithRecipe,
    });
  }

  const recipes: RecipeSuggestion[] = [];
  const remainingPurchases = purchases.filter(
    (p) => !usedPurchaseIds.has(p.productId),
  );

  for (const role of roles) {
    if (!role.isRecipe) continue;
    const ingredients = rankIngredientsForSold(role, remainingPurchases);
    for (const ing of ingredients) usedPurchaseIds.add(ing.purchase.productId);
    const bestIng = ingredients[0]?.score ?? 0;
    const band: ValidationBand =
      role.roleConfidence >= 0.72 && (ingredients.length > 0 ? bestIng >= 85 : true)
        ? ingredients.length > 0 || role.roleConfidence >= 0.78
          ? "high"
          : "review"
        : "review";
    recipes.push({
      id: `recipe:${role.item.key}`,
      sold: role.item,
      roleConfidence: role.roleConfidence,
      summaryPt: role.summaryPt,
      masterRecipeName: role.masterRecipeName,
      ingredients,
      band,
    });
  }

  const soldInSame = new Set(sameItem.map((s) => s.sold.key));
  const soldInRecipe = new Set(recipes.map((s) => s.sold.key));
  const residual: ProductSetupItem[] = [
    ...leftover,
    ...solds.filter(
      (s) => !soldInSame.has(s.key) && !soldInRecipe.has(s.key),
    ),
    ...purchases.filter((p) => !usedPurchaseIds.has(p.productId)),
  ];

  return {
    sameItem,
    recipes,
    residual,
    stats: {
      sold: solds.length,
      purchases: purchases.length,
      sameItem: sameItem.length,
      recipes: recipes.length,
      residual: residual.length,
    },
  };
}

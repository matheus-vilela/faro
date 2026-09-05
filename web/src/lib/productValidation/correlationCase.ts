import {
  PRODUCT_SETUP_CHOICE_LABEL,
  itemTurnoverQty,
  setupChoicesForItem,
  type ProductSetupChoice,
  type ProductSetupItem,
  type ProductSetupQueue,
} from "@/lib/productSetupQueue";
import type { ProductValidationResult } from "@/lib/productValidation/types";

export type CorrelationIntent =
  | "unify"
  | "recipe"
  | "produce"
  | "family"
  | "variant"
  | "ingredient"
  | "keep";

export type CorrelationCounterpart = {
  item: ProductSetupItem;
  score: number;
};

export type CorrelationCase = {
  id: string;
  subject: ProductSetupItem;
  counterparts: CorrelationCounterpart[];
  score: number;
  suggestedIntent: CorrelationIntent;
  recommendedIntents: CorrelationIntent[];
  availableIntents: CorrelationIntent[];
  /** Intent que a IA propôs; null se só há sinal local (estoque, tipo). */
  aiIntent: CorrelationIntent | null;
};

export const INTENT_TO_CHOICE: Record<CorrelationIntent, ProductSetupChoice> = {
  unify: "link_item",
  recipe: "recipe",
  produce: "intermediate",
  family: "sale_family",
  variant: "sale_family_variant",
  ingredient: "ingredient",
  keep: "skip",
};

export const CHOICE_TO_INTENT: Record<ProductSetupChoice, CorrelationIntent> = {
  link_item: "unify",
  recipe: "recipe",
  intermediate: "produce",
  sale_family: "family",
  sale_family_variant: "variant",
  ingredient: "ingredient",
  skip: "keep",
};

export function intentLabel(intent: CorrelationIntent): string {
  return PRODUCT_SETUP_CHOICE_LABEL[INTENT_TO_CHOICE[intent]];
}

export function intentsForItem(item: ProductSetupItem): CorrelationIntent[] {
  return setupChoicesForItem(item).map((option) => CHOICE_TO_INTENT[option.value]);
}

function firstAvailable(
  preferred: CorrelationIntent[],
  available: CorrelationIntent[],
): CorrelationIntent {
  for (const intent of preferred) {
    if (available.includes(intent)) return intent;
  }
  return available[0] ?? "keep";
}

export function suggestIntent(
  item: ProductSetupItem,
  available: CorrelationIntent[],
  aiHint?: CorrelationIntent,
): CorrelationIntent {
  if (item.possibleGrouping && available.includes("variant")) return "variant";
  if (aiHint && available.includes(aiHint)) return aiHint;
  if (
    item.kind === "recipe_without_ingredients" ||
    item.kind === "recipe_sales_unlinked"
  ) {
    return firstAvailable(["recipe"], available);
  }
  if (item.kind === "purchase_unlinked") {
    return firstAvailable(["ingredient", "unify", "keep"], available);
  }
  return firstAvailable(["unify", "recipe", "keep"], available);
}

function relatedIntents(suggested: CorrelationIntent): CorrelationIntent[] {
  if (suggested === "variant") return ["family", "keep"];
  if (suggested === "family") return ["variant", "keep"];
  if (suggested === "recipe") return ["produce", "unify"];
  if (suggested === "produce") return ["recipe", "keep"];
  if (suggested === "unify") return ["recipe", "keep"];
  if (suggested === "ingredient") return ["unify", "keep"];
  return ["unify"];
}

export function recommendIntents(
  suggested: CorrelationIntent,
  available: CorrelationIntent[],
  limit = 3,
): CorrelationIntent[] {
  const ranked = [
    suggested,
    ...relatedIntents(suggested),
    ...available,
  ].filter((intent, index, list) => {
    if (!available.includes(intent)) return false;
    return list.indexOf(intent) === index;
  });
  return ranked.slice(0, Math.min(limit, ranked.length));
}

export function buildCorrelationCases(
  items: ProductSetupItem[],
  result: ProductValidationResult | null,
): CorrelationCase[] {
  const sameBySold = new Map(
    (result?.sameItem ?? []).map((row) => [row.sold.productId, row]),
  );
  const recipeBySold = new Map(
    (result?.recipes ?? []).map((row) => [row.sold.productId, row]),
  );

  const cases = items.map((item) => {
    const available = intentsForItem(item);
    let counterparts: CorrelationCounterpart[] = [];
    let score = 0;
    let aiHint: CorrelationIntent | undefined;

    const same = sameBySold.get(item.productId);
    const recipe = recipeBySold.get(item.productId);
    if (same) {
      counterparts = same.candidates.map((candidate) => ({
        item: candidate.purchase,
        score: candidate.score,
      }));
      score = Math.max(0, ...counterparts.map((row) => row.score));
      aiHint = same.conflictWithRecipe ? "recipe" : "unify";
    } else if (recipe) {
      counterparts = recipe.ingredients.map((ingredient) => ({
        item: ingredient.purchase,
        score: ingredient.score,
      }));
      score = Math.max(
        Math.round(recipe.roleConfidence * 100),
        ...counterparts.map((row) => row.score),
        0,
      );
      aiHint = "recipe";
    }

    const suggestedIntent = suggestIntent(item, available, aiHint);
    return {
      id: item.key,
      subject: item,
      counterparts,
      score,
      suggestedIntent,
      recommendedIntents: recommendIntents(suggestedIntent, available),
      availableIntents: available,
      aiIntent: aiHint && available.includes(aiHint) ? aiHint : null,
    };
  });

  cases.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const turnover =
      itemTurnoverQty(b.subject) - itemTurnoverQty(a.subject);
    if (turnover !== 0) return turnover;
    return a.subject.name.localeCompare(b.subject.name, "pt-BR");
  });
  return cases;
}

export function casesFromQueue(
  queue: ProductSetupQueue,
  result: ProductValidationResult | null,
): CorrelationCase[] {
  return buildCorrelationCases(queue.items, result);
}

export function excludeResolvedCases(
  cases: CorrelationCase[],
  hiddenProductIds: ReadonlySet<string>,
): CorrelationCase[] {
  if (hiddenProductIds.size === 0) return cases;
  return cases.filter((row) => !hiddenProductIds.has(row.subject.productId));
}

import type { ProductSetupItem } from "@/lib/productSetupQueue";

export type ValidationBand = "high" | "review";

export type ValidationNameScore = {
  score: number;
  reasons: string[];
};

export type ValidationPurchaseCandidate = {
  purchase: ProductSetupItem;
  score: number;
  reasons: string[];
};

export type SameItemSuggestion = {
  id: string;
  sold: ProductSetupItem;
  candidates: ValidationPurchaseCandidate[];
  band: ValidationBand;
  conflictWithRecipe: boolean;
};

export type RecipeIngredientCandidate = {
  purchase: ProductSetupItem;
  hintKey: string;
  hintLabel: string;
  score: number;
  reasons: string[];
};

export type RecipeSuggestion = {
  id: string;
  sold: ProductSetupItem;
  roleConfidence: number;
  summaryPt: string;
  masterRecipeName: string | null;
  ingredients: RecipeIngredientCandidate[];
  band: ValidationBand;
};

export type ProductValidationResult = {
  sameItem: SameItemSuggestion[];
  recipes: RecipeSuggestion[];
  residual: ProductSetupItem[];
  /** Vendidos que a IA olhou e não achou par (também entram em residual). */
  unmatchedSold?: ProductSetupItem[];
  stats: {
    sold: number;
    purchases: number;
    sameItem: number;
    recipes: number;
    residual: number;
  };
};

export const VALIDATION_HIGH_MIN = 90;
export const VALIDATION_REVIEW_MIN = 55;
export const VALIDATION_INGREDIENT_MIN = 70;
export const VALIDATION_RECIPE_ROLE_MIN = 0.5;

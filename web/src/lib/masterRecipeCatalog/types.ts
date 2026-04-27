import type { OperationalItemType } from "@/lib/itemClassification/operationalItemTypes";

export type MasterRecipeType =
  | "SALE_RECIPE"
  | "PREP_RECIPE"
  | "BATCH_RECIPE"
  | "SUB_RECIPE"
  | "ENTRY_BREAKDOWN_RECIPE"
  | "DRINK_RECIPE"
  | "KITCHEN_RECIPE"
  | "SAUCE_BASE_RECIPE";

export type MasterRecipeStatus = "DRAFT" | "CURATED" | "DEPRECATED";
export type MasterRecipeOrigin = "SYSTEM_DEFAULT" | "TENANT_DERIVED" | "USER_CREATED";
export type MasterRecipeCurationStatus = "RECOMMENDED" | "UNDER_REVIEW" | "OBSOLETE";

export type MasterRecipeComponentDefinition = {
  componentKind: "MASTER_ITEM" | "MASTER_RECIPE";
  masterItemId?: string;
  masterRecipeId?: string;
  quantity: number;
  unitCode: string;
  yieldFactor: number;
  wasteFactor: number;
  sortOrder: number;
  optional: boolean;
};

export type MasterRecipeDefinition = {
  id: string;
  canonicalName: string;
  normalizedName: string;
  recipeType: MasterRecipeType;
  family: string;
  subcategory: string;
  description?: string;
  defaultYieldQuantity: number;
  defaultYieldUnit: string;
  defaultPortionQuantity: number;
  defaultPortionUnit: string;
  servingsCount: number;
  prepTimeMinutes: number;
  recipeCandidateScore: number;
  status: MasterRecipeStatus;
  origin: MasterRecipeOrigin;
  curationStatus: MasterRecipeCurationStatus;
  isActive: boolean;
  aliases: string[];
  components: MasterRecipeComponentDefinition[];
};

export type MasterRecipeSuggestion = {
  masterRecipeId: string;
  canonicalName: string;
  recipeType: MasterRecipeType;
  family: string;
  subcategory: string;
  score: number;
  explanationPt: string;
  likelyOperationalType: OperationalItemType;
  componentHints: Array<{
    componentKind: "MASTER_ITEM" | "MASTER_RECIPE";
    refId?: string;
    quantity: number;
    unitCode: string;
    optional: boolean;
  }>;
};

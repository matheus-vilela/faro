import type { OperationalItemType } from "../itemClassification/operationalItemTypes.ts";

/**
 * Tipos conceituais da base mestre (mais finos que o enum operacional em BD).
 */
export type MasterCatalogConceptType =
  | "INSUMO"
  | "BEBIDA_REVENDA"
  | "PRODUTO_REVENDA"
  | "ITEM_OPERACIONAL"
  | "NAO_ESTOCAVEL"
  | "RECEITA_FICHA"
  | "RECEITA_CANDIDATE"
  | "ATIVO_EQUIPAMENTO";

export type MasterAliasType =
  | "ABBREVIATION"
  | "SYNONYM"
  | "POPULAR_NAME"
  | "SUPPLIER_VARIATION"
  | "REGEX_HINT";

export type MasterItemAliasDef = {
  text: string;
  aliasType: MasterAliasType;
  weight: number;
};

export type MasterItemDefinition = {
  id: string;
  canonicalName: string;
  family: string;
  subfamily: string;
  conceptType: MasterCatalogConceptType;
  defaultUnit: string;
  purchaseUnits: string[];
  baseConfidence: number;
  recipeCandidate: boolean;
  neverRecipe: boolean;
  keywordsPositive: string[];
  keywordsNegative: string[];
  notes?: string;
  aliases: MasterItemAliasDef[];
};

export type MasterCatalogMatch = {
  masterId: string;
  canonicalName: string;
  family: string;
  subfamily: string;
  conceptType: MasterCatalogConceptType;
  operationalType: OperationalItemType;
  defaultUnit: string;
  purchaseUnits: string[];
  matchStrength: number;
  baseConfidence: number;
  effectiveScore: number;
  recipeCandidate: boolean;
  neverRecipe: boolean;
  matchedBy: "alias" | "keyword" | "compound";
  reasonPt: string;
  hitLabels: string[];
};

export type MasterCatalogReasonSummary = {
  master_item_id: string;
  family: string;
  subfamily: string;
  reason_pt: string;
  hit_labels: string[];
  default_unit: string;
  recipe_candidate: boolean;
  never_recipe: boolean;
};

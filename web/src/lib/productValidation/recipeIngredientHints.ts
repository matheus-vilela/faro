import { suggestMasterRecipeTemplate } from "@/lib/masterRecipeCatalog/suggestMasterRecipeTemplate";
import { canonicalProductName } from "@/lib/productImport/canonicalName";

export type RecipeComponentHint = {
  key: string;
  label: string;
  matchNames: string[];
};

const HINTS_BY_MASTER_ID: Record<string, RecipeComponentHint[]> = {
  "mr-drink-caipirinha-tradicional": [
    {
      key: "limao",
      label: "Limão",
      matchNames: ["limao", "limao tahiti", "lima tahiti", "limao siciliano"],
    },
    {
      key: "acucar",
      label: "Açúcar",
      matchNames: ["acucar", "acucar cristal", "xarope simples", "calda"],
    },
    {
      key: "cachaca",
      label: "Cachaça",
      matchNames: ["cachaca", "cachaca 51", "ypioca", "seleta"],
    },
  ],
  "mr-drink-caipivodka": [
    {
      key: "limao",
      label: "Limão",
      matchNames: ["limao", "limao tahiti", "lima tahiti"],
    },
    {
      key: "acucar",
      label: "Açúcar",
      matchNames: ["acucar", "xarope simples"],
    },
    { key: "vodka", label: "Vodka", matchNames: ["vodka"] },
  ],
  "mr-drink-gin-tonica": [
    { key: "gin", label: "Gin", matchNames: ["gin", "gim"] },
    {
      key: "tonica",
      label: "Tônica",
      matchNames: ["tonica", "agua tonica", "schweppes tonica"],
    },
  ],
  "mr-drink-mojito": [
    { key: "rum", label: "Rum", matchNames: ["rum", "ron"] },
    { key: "hortela", label: "Hortelã", matchNames: ["hortela", "menta"] },
    { key: "limao", label: "Limão", matchNames: ["limao", "limao tahiti"] },
    { key: "acucar", label: "Açúcar", matchNames: ["acucar", "xarope simples"] },
  ],
  "mr-drink-moscow-mule": [
    { key: "vodka", label: "Vodka", matchNames: ["vodka"] },
    {
      key: "ginger",
      label: "Ginger beer",
      matchNames: ["ginger beer", "ginger", "gengibre"],
    },
    { key: "limao", label: "Limão", matchNames: ["limao", "lime"] },
  ],
  "mr-base-xarope-simples": [
    { key: "acucar", label: "Açúcar", matchNames: ["acucar"] },
  ],
  "mr-prep-molho-casa": [
    { key: "tomate", label: "Tomate", matchNames: ["tomate", "molho tomate"] },
    { key: "cebola", label: "Cebola", matchNames: ["cebola"] },
    { key: "alho", label: "Alho", matchNames: ["alho"] },
  ],
  "mr-prep-arroz-base": [
    { key: "arroz", label: "Arroz", matchNames: ["arroz"] },
  ],
  "mr-prep-massa-pizza": [
    { key: "farinha", label: "Farinha", matchNames: ["farinha", "farinha trigo"] },
  ],
  "mr-prep-feijao-base": [
    { key: "feijao", label: "Feijão", matchNames: ["feijao"] },
  ],
  "mr-prep-maionese-casa": [
    { key: "oleo", label: "Óleo", matchNames: ["oleo", "oleo soja"] },
    { key: "limao", label: "Limão", matchNames: ["limao"] },
  ],
};

function hintsBySoldName(name: string): RecipeComponentHint[] | null {
  const n = canonicalProductName(name);
  if (!n) return null;
  if (/\bcaipivodka\b/.test(n)) return HINTS_BY_MASTER_ID["mr-drink-caipivodka"]!;
  if (/\bcaipirinha\b/.test(n)) {
    return HINTS_BY_MASTER_ID["mr-drink-caipirinha-tradicional"]!;
  }
  if (/\bgin\b/.test(n) && /\btonic/.test(n)) {
    return HINTS_BY_MASTER_ID["mr-drink-gin-tonica"]!;
  }
  if (/\bmojito\b/.test(n)) return HINTS_BY_MASTER_ID["mr-drink-mojito"]!;
  if (/\bmoscow\b/.test(n) || /\bmule\b/.test(n)) {
    return HINTS_BY_MASTER_ID["mr-drink-moscow-mule"]!;
  }
  return null;
}

export function componentHintsForSold(
  name: string,
  masterRecipeId?: string | null,
): RecipeComponentHint[] {
  if (masterRecipeId && HINTS_BY_MASTER_ID[masterRecipeId]) {
    return HINTS_BY_MASTER_ID[masterRecipeId]!;
  }
  const fromName = hintsBySoldName(name);
  if (fromName) return fromName;
  const suggested = suggestMasterRecipeTemplate(name);
  if (suggested?.masterRecipeId && HINTS_BY_MASTER_ID[suggested.masterRecipeId]) {
    return HINTS_BY_MASTER_ID[suggested.masterRecipeId]!;
  }
  return [];
}

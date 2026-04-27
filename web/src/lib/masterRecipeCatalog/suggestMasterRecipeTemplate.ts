import type { OperationalItemType } from "@/lib/itemClassification/operationalItemTypes";
import { matchRecipeFichaProhibitionLabels } from "@/lib/itemClassification/namingImportSignals";
import { canonicalProductName, stripDiacriticsLower } from "@/lib/productImport/canonicalName";
import { MASTER_RECIPE_DEFINITIONS } from "@/lib/masterRecipeCatalog/seedRegistry";
import type { MasterRecipeDefinition, MasterRecipeSuggestion } from "@/lib/masterRecipeCatalog/types";

const RECIPE_SIGNALS: Array<{ re: RegExp; score: number; label: string }> = [
  { re: /\bcaipirinha\b/i, score: 0.35, label: "caipirinha" },
  { re: /\bcaipivodka\b/i, score: 0.34, label: "caipivodka" },
  { re: /\bgin\s*tonica|gin\s*t[ôo]nica\b/i, score: 0.34, label: "gin_tonica" },
  { re: /\bmojito\b/i, score: 0.34, label: "mojito" },
  { re: /\bmoscow\b|\bmule\b/i, score: 0.33, label: "moscow_mule" },
  { re: /\bxarope\b/i, score: 0.3, label: "xarope" },
  { re: /\bmolho\b/i, score: 0.28, label: "molho" },
  { re: /\bfeij[aã]o\b/i, score: 0.28, label: "feijao" },
  { re: /\bmaionese\b/i, score: 0.3, label: "maionese" },
  { re: /\bbase\b/i, score: 0.22, label: "base" },
  { re: /\bpure|pur[eê]\b/i, score: 0.2, label: "pure" },
  { re: /\bmassa\s*de\s*pizza\b/i, score: 0.32, label: "massa_pizza" },
];

const HARD_BLOCK_READY_RESALE =
  /\b(ipa|pils|pilsen|lata\s*\d+|long\s*neck|refrigerante\s*lata|cerveja)\b/i;

function toOperationalType(def: MasterRecipeDefinition): OperationalItemType {
  if (def.recipeType === "DRINK_RECIPE") return "RECEITA_FICHA";
  if (def.recipeType === "ENTRY_BREAKDOWN_RECIPE") return "RECEITA_FICHA";
  return "INSUMO";
}

function templateScore(def: MasterRecipeDefinition, name: string, norm: string): { score: number; reasons: string[] } {
  let score = def.recipeCandidateScore * 0.45;
  const reasons: string[] = [];
  const combined = `${name} ${norm}`;
  for (const a of def.aliases) {
    const an = stripDiacriticsLower(a);
    if (an && combined.includes(an)) {
      score += 0.22;
      reasons.push(a);
    }
  }
  if (combined.includes(def.normalizedName)) {
    score += 0.28;
    reasons.push(def.canonicalName);
  }
  for (const s of RECIPE_SIGNALS) {
    if (s.re.test(combined)) {
      score += s.score * 0.4;
      reasons.push(s.label);
    }
  }
  return { score: Math.min(0.99, score), reasons };
}

export function suggestMasterRecipeTemplate(name: string): MasterRecipeSuggestion | null {
  const raw = (name ?? "").trim();
  if (!raw) return null;
  const norm = canonicalProductName(raw);
  if (matchRecipeFichaProhibitionLabels(raw).length > 0 || HARD_BLOCK_READY_RESALE.test(raw)) {
    return null;
  }
  let best: { def: MasterRecipeDefinition; score: number; reasons: string[] } | null = null;
  for (const def of MASTER_RECIPE_DEFINITIONS) {
    if (!def.isActive || def.status === "DEPRECATED") continue;
    const s = templateScore(def, raw, norm);
    if (s.score < 0.55) continue;
    if (!best || s.score > best.score) best = { def, score: s.score, reasons: s.reasons };
  }
  if (!best) return null;
  const bits = best.reasons.slice(0, 3).join(", ") || best.def.subcategory;
  const explanationPt =
    best.def.recipeType === "DRINK_RECIPE"
      ? `Sugerido como ficha de drink porque contém ${bits} e possui componentes compatíveis do bar.`
      : `Sugerido como base/preparo porque contém ${bits} e possui composição compatível para ficha técnica.`;
  return {
    masterRecipeId: best.def.id,
    canonicalName: best.def.canonicalName,
    recipeType: best.def.recipeType,
    family: best.def.family,
    subcategory: best.def.subcategory,
    score: best.score,
    explanationPt,
    likelyOperationalType: toOperationalType(best.def),
    componentHints: best.def.components.map((c) => ({
      componentKind: c.componentKind,
      refId: c.masterItemId ?? c.masterRecipeId,
      quantity: c.quantity,
      unitCode: c.unitCode,
      optional: c.optional,
    })),
  };
}

export function buildMasterRecipeImportReasons(name: string): Record<string, unknown> {
  const s = suggestMasterRecipeTemplate(name);
  if (!s) {
    return {
      master_recipe: null,
      master_recipe_note: "Não sugerido como ficha porque o item aparenta ser produto pronto/revenda ou não possui sinais compostos.",
    };
  }
  return {
    master_recipe: {
      master_recipe_id: s.masterRecipeId,
      canonical_name: s.canonicalName,
      recipe_type: s.recipeType,
      family: s.family,
      subcategory: s.subcategory,
      score: s.score,
      explanation_pt: s.explanationPt,
      likely_operational_type: s.likelyOperationalType,
      component_hints: s.componentHints,
    },
  };
}

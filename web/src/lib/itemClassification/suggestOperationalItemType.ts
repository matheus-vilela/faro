import type { OperationalItemType } from "@/lib/itemClassification/operationalItemTypes";
import { stripDiacriticsLower } from "@/lib/productImport/canonicalName";
import { applyLearningTalliesToScores, applyPeerTalliesToScores } from "@/lib/itemClassification/peerNameHints";
import {
  buildSuggestionSummaryPt,
  detectOperationalFamily,
  type HospitalityOperationSegment,
  type OperationalFamilyCode,
  scoreHospitalityByName,
} from "@/lib/itemClassification/hospitalityLexicon";
import { matchRecipeFichaProhibitionLabels } from "@/lib/itemClassification/namingImportSignals";
import type { CompanyMasterCatalogOverrideInput } from "@/lib/masterItemCatalog/companyContext";
import { applyMasterCatalogToScores } from "@/lib/masterItemCatalog/resolveMasterItemCatalog";
import { suggestMasterRecipeTemplate } from "@/lib/masterRecipeCatalog/suggestMasterRecipeTemplate";

export type SuggestionReasons = {
  positive_hits?: string[];
  negative_hits?: string[];
  name_normalized?: string;
  stock_control_hint?: string;
  summary_pt?: string;
  operational_family?: OperationalFamilyCode;
  engine_version?: string;
  peer_hint?: string;
  learning_hint?: string;
  scores_by_type?: Partial<Record<OperationalItemType, number>>;
  /** Base mestre global (hospitalidade) — auditável. */
  master_catalog?: {
    master_item_id: string;
    family: string;
    subfamily: string;
    reason_pt: string;
    default_unit: string;
    never_recipe: boolean;
    recipe_candidate: boolean;
  };
  master_recipe?: {
    master_recipe_id: string;
    canonical_name: string;
    recipe_type: string;
    score: number;
    explanation_pt: string;
  } | null;
};

export type SuggestFromNameInput = {
  name: string;
  stockControlType?: string | null;
  operationSegment?: HospitalityOperationSegment;
  peerNameTypeTallies?: Partial<Record<OperationalItemType, number>>;
  /** Decisões confirmadas (mesmo rótulo normalizado) vinda de `company_item_classification_learning`. */
  classificationLearningTallies?: Partial<Record<OperationalItemType, number>>;
  companyMasterCatalogOverrides?: CompanyMasterCatalogOverrideInput[] | null;
};

export type SuggestFromNameResult = {
  suggested_type: OperationalItemType;
  suggested_score: number;
  suggestion_reasons: SuggestionReasons;
};

const ENGINE = "hospitality_v1+master_v1";

/**
 * Heurística com vocabulário de bar/restaurante, bloqueio de ficha falsa
 * e reforço por histórico (outros itens com o mesmo nome canónico).
 */
export function suggestOperationalItemTypeFromName(
  input: SuggestFromNameInput,
): SuggestFromNameResult {
  const raw = (input.name ?? "").trim();
  const norm = stripDiacriticsLower(raw);
  const segment: HospitalityOperationSegment = input.operationSegment ?? "geral";

  if (input.stockControlType === "RECIPE_CONTROLLED" || input.stockControlType === "COMPOSITE") {
    return finish("RECEITA_FICHA", 0.78, {
      name_normalized: norm,
      positive_hits: ["stock_control_composite_or_recipe"],
      stock_control_hint: input.stockControlType,
      engine_version: ENGINE,
    });
  }

  const base = scoreHospitalityByName({ name: raw, norm, operationSegment: segment });
  const applied = applyPeerTalliesToScores(base.scores, input.peerNameTypeTallies);
  const learned = applyLearningTalliesToScores(applied.next, input.classificationLearningTallies);
  const masterBlend = applyMasterCatalogToScores(
    { ...learned.next },
    { name: raw, normalizedName: norm },
    { companyOverrides: input.companyMasterCatalogOverrides ?? null },
  );
  let scores = { ...learned.next, ...masterBlend.next } as typeof base.scores;
  const masterMatch = masterBlend.match;
  const masterRecipe = suggestMasterRecipeTemplate(raw);

  const negRecipe = matchRecipeFichaProhibitionLabels(raw);
  if (negRecipe.length > 0) {
    scores = {
      ...scores,
      RECEITA_FICHA: Math.min(0.1, scores.RECEITA_FICHA * 0.2),
    };
  }

  const sorted = (Object.keys(scores) as OperationalItemType[])
    .map((k) => [k, scores[k as keyof typeof scores] as number] as const)
    .sort((a, b) => b[1] - a[1]);
  const best = sorted[0]!;
  const s2 = sorted[1]?.[1] ?? 0;
  let win: OperationalItemType = best[0] as OperationalItemType;
  let wScore = best[1];
  const gap = wScore - s2;
  if (gap < 0.048) {
    if (
      /ipa|pils|apa|lager|stout|cervej|cerv|chope|chopp|barril|lata|473|600|355|350|garrafa|long|neck|keg|draft/i.test(
        norm,
      ) &&
      scores.PRODUTO_REVENDA + 0.02 >= scores.INSUMO
    ) {
      win = "PRODUTO_REVENDA";
      wScore = scores.PRODUTO_REVENDA;
    } else if (
      /(tahit|tahiti|lim(ão|ao|a\w*)\s*10|xarope de a[cç]uc|a[cç]ucar refin|polpa.*\d+\s*kg|10\s*kg|5\s*kg)/i.test(
        raw + " " + norm,
      ) &&
      scores.INSUMO >= 0.4
    ) {
      win = "INSUMO";
      wScore = scores.INSUMO;
    } else if (/(moho|molho)\s*da\s*casa/i.test(raw) && scores.RECEITA_FICHA >= 0.2) {
      win = "RECEITA_FICHA";
      wScore = scores.RECEITA_FICHA;
    }
  }
  const family = detectOperationalFamily(raw, win);
  const top2 = s2;
  const margin = wScore - top2;
  const conf = Math.min(
    0.97,
    Math.max(0.22, 0.3 + wScore * 0.5 + Math.min(0.18, margin * 0.5)),
  );
  const summary = buildSuggestionSummaryPt({
    name: raw,
    winning: win,
    family,
    scores,
    signalLabels: base.signalLabels,
    recipeBlocks: base.recipeBlocks,
  });
  return finish(win, conf, {
    name_normalized: norm,
    positive_hits: [
      ...base.signalLabels,
      ...(applied.peerLabel ? [applied.peerLabel] : []),
      ...(learned.learningLabel ? [learned.learningLabel] : []),
      ...(masterMatch ? [`master:${masterMatch.masterId}`] : []),
    ],
    negative_hits: negRecipe,
    engine_version: ENGINE,
    summary_pt:
      negRecipe.length > 0 && win !== "RECEITA_FICHA"
        ? `${summary} (Receita com baixa prioridade: ${negRecipe.join(", ")}).`
        : summary,
    operational_family: family,
    peer_hint: applied.peerLabel,
    learning_hint: learned.learningLabel,
    scores_by_type: scores,
    master_catalog: masterMatch
      ? {
          master_item_id: masterMatch.masterId,
          family: masterMatch.family,
          subfamily: masterMatch.subfamily,
          reason_pt: masterMatch.reasonPt,
          default_unit: masterMatch.defaultUnit,
          never_recipe: masterMatch.neverRecipe,
          recipe_candidate: masterMatch.recipeCandidate,
        }
      : undefined,
    master_recipe: masterRecipe
      ? {
          master_recipe_id: masterRecipe.masterRecipeId,
          canonical_name: masterRecipe.canonicalName,
          recipe_type: masterRecipe.recipeType,
          score: masterRecipe.score,
          explanation_pt: masterRecipe.explanationPt,
        }
      : null,
  });
}

function finish(
  t: OperationalItemType,
  score: number,
  rest: SuggestionReasons,
): SuggestFromNameResult {
  return {
    suggested_type: t,
    suggested_score: Math.round(Math.min(1, Math.max(0, score)) * 10000) / 10000,
    suggestion_reasons: rest,
  };
}

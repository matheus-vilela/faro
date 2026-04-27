import type { OperationalItemType } from "../itemClassification/operationalItemTypes.ts";
import { mapMasterConceptToOperational } from "./mapMasterToOperational.ts";
import {
  masterCatalogAliasMatchesText,
  masterCatalogNorm,
  nameOrAliasMatchesBlob,
} from "./matchText.ts";
import { MASTER_ITEM_DEFINITIONS } from "./seedRegistry.ts";
import type { CompanyMasterCatalogOverrideInput } from "./companyContext.ts";
import type { MasterCatalogConceptType, MasterCatalogMatch, MasterItemDefinition } from "./types.ts";

function norm(s: string): string {
  return masterCatalogNorm(s);
}

function scoreDefinition(
  def: MasterItemDefinition,
  blob: string,
): { score: number; hits: string[]; matchedBy: "alias" | "keyword" | "compound" } {
  const hits: string[] = [];
  let best = 0;
  let hasAlias = false;
  for (const a of def.aliases) {
    const aNorm = norm(a.text);
    if (!aNorm) continue;
    if (masterCatalogAliasMatchesText(blob, aNorm)) {
      hasAlias = true;
      const s = a.weight * def.baseConfidence;
      if (s > best) best = s;
      hits.push(a.text);
    }
  }
  for (const k of def.keywordsPositive) {
    const kn = norm(k);
    if (kn && blob.includes(kn)) {
      best = Math.min(0.99, best + 0.035);
      if (!hits.includes(k)) hits.push(`+${k}`);
    }
  }
  let mult = 1;
  for (const k of def.keywordsNegative) {
    const kn = norm(k);
    if (kn && blob.includes(kn)) mult *= 0.25;
  }
  best *= mult;
  if (best < 0.02) {
    for (const k of def.keywordsPositive) {
      const kn = norm(k);
      if (kn && blob.length > 0 && !hasAlias) {
        if (kn.length >= 4 && blob.includes(kn)) {
          const s = def.baseConfidence * 0.55;
          if (s > best) {
            best = s;
            hits.length = 0;
            hits.push(k);
            return { score: best, hits, matchedBy: "keyword" };
          }
        }
      }
    }
  }
  if (best < 0.01) {
    return { score: 0, hits: [], matchedBy: "alias" };
  }
  return { score: Math.min(0.99, best), hits, matchedBy: hasAlias ? "compound" : "keyword" };
}

function buildReasonPt(def: MasterItemDefinition, hits: string[]): string {
  const clean = hits.filter((h) => !h.startsWith("+")).slice(0, 4);
  const bits = clean.length > 0 ? clean.join(", ") : def.subfamily;
  return `Base mestre: ${def.family} — ${def.canonicalName} (sinais: ${bits}).`;
}

function definitionToMatch(
  def: MasterItemDefinition,
  score: number,
  hits: string[],
  matchedBy: "alias" | "keyword" | "compound",
): MasterCatalogMatch {
  const operational = mapMasterConceptToOperational(def.conceptType);
  return {
    masterId: def.id,
    canonicalName: def.canonicalName,
    family: def.family,
    subfamily: def.subfamily,
    conceptType: def.conceptType,
    operationalType: operational,
    defaultUnit: def.defaultUnit,
    purchaseUnits: def.purchaseUnits,
    matchStrength: score,
    baseConfidence: def.baseConfidence,
    effectiveScore: score,
    recipeCandidate: def.recipeCandidate,
    neverRecipe: def.neverRecipe,
    matchedBy: hits.length === 0 ? "alias" : matchedBy,
    reasonPt: buildReasonPt(def, hits),
    hitLabels: hits.filter((h) => !h.startsWith("+")),
  };
}

export type ResolveMasterInput = {
  name: string;
  /** Se omitido, deriva de `name`. */
  normalizedName?: string;
};

/**
 * Escolhe o override de empresa com maior prioridade (ligação ao `masterId` + tipo explícito).
 */
function pickCompanyOverride(
  blob: string,
  overrides: CompanyMasterCatalogOverrideInput[] | null | undefined,
  base: MasterCatalogMatch | null,
): CompanyMasterCatalogOverrideInput | null {
  if (!overrides?.length) return null;
  const cands = overrides.filter(
    (o) => o.active && nameOrAliasMatchesBlob(blob, o.custom_name, o.custom_alias),
  );
  if (!cands.length) return null;
  cands.sort((a, b) => {
    const la = a.master_external_key && base?.masterId && a.master_external_key === base.masterId ? 1 : 0;
    const lb = b.master_external_key && base?.masterId && b.master_external_key === base.masterId ? 1 : 0;
    if (lb !== la) return lb - la;
    const ha = a.override_operational_type ? 1 : 0;
    const hb = b.override_operational_type ? 1 : 0;
    if (hb !== ha) return hb - ha;
    const sa = a.score_adjustment != null && Number.isFinite(a.score_adjustment) ? 1 : 0;
    const sb = b.score_adjustment != null && Number.isFinite(b.score_adjustment) ? 1 : 0;
    return sb - sa;
  });
  return cands[0] ?? null;
}

/**
 * Aplica ajuste local ao `match` (auditoria) e retorna cópia.
 */
function mergeOverrideIntoMatch(
  base: MasterCatalogMatch | null,
  _blob: string,
  ov: CompanyMasterCatalogOverrideInput,
): MasterCatalogMatch {
  const label = (ov.custom_alias || ov.custom_name || "regra local").trim();
  if (base) {
    return {
      ...base,
      operationalType: ov.override_operational_type ?? base.operationalType,
      reasonPt: `Regra da unidade: ${label}. ${base.reasonPt}`,
    };
  }
  const op = ov.override_operational_type;
  if (!op) {
    return {
      masterId: ov.master_external_key ?? "company-override",
      canonicalName: label,
      family: "Regras da unidade",
      subfamily: label,
      conceptType: "INSUMO" as MasterCatalogConceptType,
      operationalType: "REVISAO_PENDENTE",
      defaultUnit: "un",
      purchaseUnits: [],
      matchStrength: 0.35,
      baseConfidence: 0.4,
      effectiveScore: 0.35,
      recipeCandidate: false,
      neverRecipe: false,
      matchedBy: "alias",
      reasonPt: `Regra da unidade: ${label} (defina o tipo no cadastro).`,
      hitLabels: [label],
    };
  }
  return {
    masterId: ov.master_external_key ?? "company-override",
    canonicalName: label,
    family: "Regras da unidade",
    subfamily: label,
    conceptType: "INSUMO" as MasterCatalogConceptType,
    operationalType: op,
    defaultUnit: "un",
    purchaseUnits: [],
    matchStrength: 0.45,
    baseConfidence: 0.5,
    effectiveScore: 0.45,
    recipeCandidate: false,
    neverRecipe: false,
    matchedBy: "alias",
    reasonPt: `Regra da unidade: ${label} — tipo sugerido ${op}.`,
    hitLabels: [label],
  };
}

/**
 * Aplica score boost a partir de override (ligado ao `master` ou forçado).
 */
function applyOverrideScoreDeltas(
  next: Partial<Record<OperationalItemType, number>>,
  base: MasterCatalogMatch | null,
  ov: CompanyMasterCatalogOverrideInput,
): void {
  const addBase =
    0.28 +
    (ov.score_adjustment != null && Number.isFinite(ov.score_adjustment)
      ? 0.45 * Math.min(1, Math.max(-1, Number(ov.score_adjustment)))
      : 0);
  if (ov.override_operational_type) {
    const o = ov.override_operational_type;
    next[o] = Math.min(0.99, (next[o] ?? 0) + Math.max(0.15, addBase));
  } else if (base && ov.master_external_key && ov.master_external_key === base.masterId) {
    const t = base.operationalType;
    next[t] = Math.min(0.99, (next[t] ?? 0) + Math.max(0, addBase * 0.5));
  }
}

export type ApplyMasterCatalogContext = {
  companyOverrides?: CompanyMasterCatalogOverrideInput[] | null;
};

/**
 * Resolve a linha (nome de produto, item de NF) contra a base mestre em memória
 * (overrides de empresa aplicados no `applyMasterCatalogToScores` e em `buildMasterImportReasons`).
 */
export function resolveMasterItemCatalog(
  input: ResolveMasterInput,
  _context?: ApplyMasterCatalogContext,
): MasterCatalogMatch | null {
  const raw = (input.name ?? "").trim();
  if (!raw) return null;
  const blob = (input.normalizedName ?? norm(raw)).toLowerCase();

  let best: { def: MasterItemDefinition; score: number; hits: string[]; matchedBy: "alias" | "keyword" | "compound" } | null =
    null;
  for (const def of MASTER_ITEM_DEFINITIONS) {
    const r = scoreDefinition(def, blob);
    if (r.score < 0.12) continue;
    if (!best || r.score > best.score) {
      best = { def, score: r.score, hits: r.hits, matchedBy: r.matchedBy };
    }
  }
  if (!best) return null;

  const { def, score, hits, matchedBy } = best;
  return definitionToMatch(def, score, hits, matchedBy);
}

/**
 * Aplica sinais da base ao mapa de scores 0–1 usado em `hospitalityLexicon`.
 */
export function applyMasterCatalogToScores(
  scores: Partial<Record<OperationalItemType, number>>,
  input: ResolveMasterInput,
  context?: ApplyMasterCatalogContext,
): { next: Partial<Record<OperationalItemType, number>>; match: MasterCatalogMatch | null } {
  const raw = (input.name ?? "").trim();
  const blob = (input.normalizedName ?? norm(raw)).toLowerCase();

  const m0 = resolveMasterItemCatalog(input);
  const next = { ...scores };

  if (m0) {
    const op0 = m0.operationalType;
    const boost = Math.max(0, m0.effectiveScore) * 0.92;
    const prev = next[op0] ?? 0;
    next[op0] = Math.min(0.99, Math.max(prev, boost, prev + 0.12 * m0.matchStrength));
    if (m0.neverRecipe) {
      const rf = next.RECEITA_FICHA ?? 0;
      next.RECEITA_FICHA = Math.min(0.08, rf * 0.3);
    }
  }

  const ov = pickCompanyOverride(blob, context?.companyOverrides ?? null, m0);
  if (ov) {
    applyOverrideScoreDeltas(next, m0, ov);
  }
  const m = ov ? mergeOverrideIntoMatch(m0, blob, ov) : m0;

  return { next, match: m };
}

export type MasterImportLineLearningHint = {
  normalized_key: string;
  tallies: Partial<Record<OperationalItemType, number>>;
};

/**
 * Sinais de auditoria para o motor de import (JSON persistido com a linha).
 */
export function buildMasterImportReasons(
  name: string,
  ctx?: { companyOverrides?: CompanyMasterCatalogOverrideInput[] | null; lineLearning?: MasterImportLineLearningHint | null },
): Record<string, unknown> {
  const raw = (name ?? "").trim();
  if (!raw) return {};
  const blob = masterCatalogNorm(raw).toLowerCase();
  let m = resolveMasterItemCatalog({ name: raw, normalizedName: blob });
  const ov = pickCompanyOverride(blob, ctx?.companyOverrides ?? null, m);
  if (ov) {
    m = mergeOverrideIntoMatch(m, blob, ov);
  }
  const out: Record<string, unknown> = {};
  if (m) {
    out.master_catalog = {
      master_item_id: m.masterId,
      family: m.family,
      subfamily: m.subfamily,
      reason_pt: m.reasonPt,
      default_unit: m.defaultUnit,
      never_recipe: m.neverRecipe,
      recipe_candidate: m.recipeCandidate,
      operational_type: m.operationalType,
    };
  }
  const learn = ctx?.lineLearning;
  if (learn && learn.tallies && Object.keys(learn.tallies).length) {
    out.classification_learning = {
      normalized_key: learn.normalized_key,
      top_type: (
        (Object.keys(learn.tallies) as OperationalItemType[]).sort(
          (a, b) => (learn.tallies[b] ?? 0) - (learn.tallies[a] ?? 0),
        )[0] ?? null
      ),
      tallies: learn.tallies,
    };
  }
  return out;
}

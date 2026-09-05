import {
  compareTurnoverDesc,
  type ProductSetupItem,
} from "@/lib/productSetupQueue";
import type {
  ProductValidationResult,
  RecipeIngredientCandidate,
  RecipeSuggestion,
  SameItemSuggestion,
  ValidationBand,
} from "@/lib/productValidation/types";
import { VALIDATION_HIGH_MIN } from "@/lib/productValidation/types";

export type AiCorrelationKind = "same_item" | "recipe" | "unmatched";

export type AiCorrelationAssignment = {
  soldId: string;
  kind: AiCorrelationKind;
  purchasedIds: string[];
  ingredientLabels: Record<string, string>;
  confidence: number;
  reasonPt: string;
};

export type AiCorrelationRaw = {
  sold?: string;
  sold_id?: string;
  kind?: string;
  purchased?: unknown;
  ingredients?: unknown;
  confidence?: unknown;
  reason?: unknown;
  reason_pt?: unknown;
};

function asIdList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          const o = item as Record<string, unknown>;
          return String(o.id ?? o.purchased ?? o.purchased_id ?? "").trim();
        }
        return "";
      })
      .filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}

function ingredientLabelsFrom(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(raw)) return out;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? o.purchased ?? o.purchased_id ?? "").trim();
    const label = String(o.label ?? o.hint ?? o.name ?? "").trim();
    if (id) out[id] = label || "Insumo";
  }
  return out;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n > 1 && n <= 100) return n / 100;
  return Math.min(1, Math.max(0, n));
}

export function parseAiCorrelationRaw(
  raw: unknown,
  soldIds: Set<string>,
  purchasedIds: Set<string>,
): AiCorrelationAssignment[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { assignments?: unknown }).assignments)
      ? (raw as { assignments: unknown[] }).assignments
      : [];
  const out: AiCorrelationAssignment[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as AiCorrelationRaw;
    const soldId = String(r.sold ?? r.sold_id ?? "").trim();
    if (!soldIds.has(soldId)) continue;
    const kindRaw = String(r.kind ?? "").trim().toLowerCase();
    const kind: AiCorrelationKind =
      kindRaw === "recipe" || kindRaw === "ficha" || kindRaw === "ficha_tecnica"
        ? "recipe"
        : kindRaw === "unmatched" || kindRaw === "none" || kindRaw === "skip"
          ? "unmatched"
          : "same_item";
    const fromPurchased = asIdList(r.purchased).filter((id) => purchasedIds.has(id));
    const labels = ingredientLabelsFrom(r.ingredients);
    const fromIngredients = Object.keys(labels).filter((id) => purchasedIds.has(id));
    const purchasedIdsRanked =
      kind === "recipe"
        ? [...fromIngredients, ...fromPurchased.filter((id) => !labels[id])]
        : fromPurchased;
    const unique: string[] = [];
    for (const id of purchasedIdsRanked) {
      if (!unique.includes(id)) unique.push(id);
    }
    out.push({
      soldId,
      kind: unique.length === 0 && kind !== "unmatched" ? "unmatched" : kind,
      purchasedIds: unique,
      ingredientLabels: labels,
      confidence: clamp01(Number(r.confidence ?? 0)),
      reasonPt: String(r.reason_pt ?? r.reason ?? "").trim(),
    });
  }
  return out;
}

/**
 * Garante 1 proposta por vendido. Compra só entra em um same_item (o de maior confiança).
 * Um same_item pode ficar com várias compras (mesmo item de fornecedores/EANs diferentes).
 * Insumo de ficha não pode ser o mesmo cadastro de um same_item.
 */
export function finalizeAiAssignments(
  soldIds: string[],
  parsed: AiCorrelationAssignment[],
): AiCorrelationAssignment[] {
  const bySold = new Map<string, AiCorrelationAssignment>();
  for (const row of parsed) {
    const prev = bySold.get(row.soldId);
    if (!prev || row.confidence > prev.confidence) bySold.set(row.soldId, row);
  }

  const sameItem = [...bySold.values()]
    .filter((row) => row.kind === "same_item" && row.purchasedIds[0])
    .sort((a, b) => b.confidence - a.confidence);
  const usedSame = new Set<string>();
  for (const row of sameItem) {
    const available = row.purchasedIds.filter((id) => !usedSame.has(id));
    if (!available[0]) {
      bySold.set(row.soldId, {
        ...row,
        kind: "unmatched",
        purchasedIds: [],
        reasonPt: row.reasonPt || "A compra candidata já foi usada em outro vínculo.",
      });
      continue;
    }
    for (const id of available) usedSame.add(id);
    bySold.set(row.soldId, { ...row, purchasedIds: available });
  }

  for (const row of bySold.values()) {
    if (row.kind !== "recipe") continue;
    const ingredients = row.purchasedIds.filter((id) => !usedSame.has(id));
    if (ingredients.length === 0) {
      bySold.set(row.soldId, {
        ...row,
        purchasedIds: [],
        reasonPt:
          row.reasonPt ||
          "Parece ficha técnica; nenhum insumo livre na lista de compras.",
      });
      continue;
    }
    bySold.set(row.soldId, { ...row, purchasedIds: ingredients });
  }

  return soldIds.map((soldId) => {
    const row = bySold.get(soldId);
    if (row) return row;
    return {
      soldId,
      kind: "unmatched" as const,
      purchasedIds: [],
      ingredientLabels: {},
      confidence: 0,
      reasonPt: "A IA não devolveu este item; ficou sem par.",
    };
  });
}

function bandFromConfidence(confidence: number): ValidationBand {
  return clamp01(confidence) * 100 >= VALIDATION_HIGH_MIN ? "high" : "review";
}

function scoreFromConfidence(confidence: number): number {
  return Math.round(clamp01(confidence) * 100);
}

export function mapAiAssignmentsToValidationResult(input: {
  sold: ProductSetupItem[];
  purchased: ProductSetupItem[];
  leftover: ProductSetupItem[];
  assignments: AiCorrelationAssignment[];
}): ProductValidationResult {
  const soldById = new Map(input.sold.map((row) => [row.productId, row]));
  const purchasedById = new Map(
    input.purchased.map((row) => [row.productId, row]),
  );
  const usedPurchases = new Set<string>();
  const sameItem: SameItemSuggestion[] = [];
  const recipes: RecipeSuggestion[] = [];
  const unmatchedSold: ProductSetupItem[] = [];

  for (const row of input.assignments) {
    const sold = soldById.get(row.soldId);
    if (!sold) continue;
    if (row.kind === "same_item") {
      const candidates = row.purchasedIds
        .map((id) => purchasedById.get(id))
        .filter((x): x is ProductSetupItem => Boolean(x))
        .map((purchase, index) => ({
          purchase,
          score: Math.max(1, scoreFromConfidence(row.confidence) - index * 6),
          reasons: row.reasonPt ? [row.reasonPt] : [],
        }));
      if (!candidates[0]) {
        unmatchedSold.push(sold);
        continue;
      }
      const band = bandFromConfidence(row.confidence);
      if (band === "high") {
        for (const candidate of candidates) {
          usedPurchases.add(candidate.purchase.productId);
        }
      }
      sameItem.push({
        id: `same:${sold.key}`,
        sold,
        candidates,
        band,
        conflictWithRecipe: false,
      });
      continue;
    }
    if (row.kind === "recipe") {
      const ingredients: RecipeIngredientCandidate[] = [];
      const band = bandFromConfidence(row.confidence);
      for (const id of row.purchasedIds) {
        const purchase = purchasedById.get(id);
        if (!purchase) continue;
        if (band === "high") usedPurchases.add(id);
        const label = row.ingredientLabels[id] || "Insumo";
        ingredients.push({
          purchase,
          hintKey: label.toLowerCase(),
          hintLabel: label,
          score: scoreFromConfidence(row.confidence),
          reasons: row.reasonPt ? [row.reasonPt] : [],
        });
      }
      recipes.push({
        id: `recipe:${sold.key}`,
        sold,
        roleConfidence: clamp01(row.confidence),
        summaryPt: row.reasonPt || "Sugerido como ficha técnica pelo nome do PDV.",
        masterRecipeName: null,
        ingredients,
        band,
      });
      continue;
    }
    unmatchedSold.push(sold);
  }

  const highSoldIds = new Set([
    ...sameItem.filter((row) => row.band === "high").map((row) => row.sold.productId),
    ...recipes.filter((row) => row.band === "high").map((row) => row.sold.productId),
  ]);
  const residualSold = input.sold.filter((row) => !highSoldIds.has(row.productId));
  const residual: ProductSetupItem[] = [];
  const seenKeys = new Set<string>();
  for (const row of [
    ...input.leftover,
    ...residualSold,
    ...input.purchased.filter((row) => !usedPurchases.has(row.productId)),
  ]) {
    if (seenKeys.has(row.key)) continue;
    seenKeys.add(row.key);
    residual.push(row);
  }
  residual.sort(compareTurnoverDesc);

  return {
    sameItem,
    recipes,
    residual,
    unmatchedSold,
    stats: {
      sold: input.sold.length,
      purchases: input.purchased.length,
      sameItem: sameItem.filter((row) => row.band === "high").length,
      recipes: recipes.filter((row) => row.band === "high").length,
      residual: residual.length,
    },
  };
}

import {
  draftsToConversionRows,
  listMergeUnitFactorCandidates,
  resolveMergeUnitFactor,
} from "@/lib/mergeProductUnits";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";

export type IncomingFactorDraft = {
  conversions: ProductUnitConversionDraft[];
  factorMode: "candidate" | "manual";
  selectedFactorId: string | null;
  manualLoserQty: string;
  manualWinnerQty: string;
};

export function emptyIncomingFactor(): IncomingFactorDraft {
  return {
    conversions: [],
    factorMode: "candidate",
    selectedFactorId: null,
    manualLoserQty: "1",
    manualWinnerQty: "1",
  };
}

export function incomingEffectiveFactor(
  winner: Product,
  loser: Product,
  winnerConversions: ProductUnitConversionDraft[],
  draft: IncomingFactorDraft,
): number | null {
  if (draft.factorMode === "manual") {
    const a = parseFloat(
      draft.manualLoserQty.replace(/\s/g, "").replace(",", "."),
    );
    const b = parseFloat(
      draft.manualWinnerQty.replace(/\s/g, "").replace(",", "."),
    );
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
      return null;
    }
    return b / a;
  }
  const candidates = listMergeUnitFactorCandidates({
    winnerHub: winner.unit,
    winnerConversions: draftsToConversionRows(winnerConversions),
    loserHub: loser.unit,
    loserConversions: draftsToConversionRows(draft.conversions),
    winnerName: winner.name,
    loserName: loser.name,
  });
  const selected = candidates.find((c) => c.id === draft.selectedFactorId);
  if (selected) return selected.factor;
  const resolved = resolveMergeUnitFactor({
    winnerHub: winner.unit,
    winnerConversions: draftsToConversionRows(winnerConversions),
    loserHub: loser.unit,
    loserConversions: draftsToConversionRows(draft.conversions),
  });
  if (resolved.kind === "same") return 1;
  if (resolved.kind === "auto") return resolved.factor;
  return null;
}

import { isWasteStockMovement } from "@/lib/stockMovementFilters";
import { isProductMergeReferenceType } from "@/types/productMergeAudit";
import type { StockMovementProductMergeMeta } from "@/types/productMergeAudit";

export type StockMovementTypeKind =
  | "in"
  | "out"
  | "waste"
  | "merge"
  | "merge_undo";

export function isProductMergeStockMovement(row: {
  reference_type: string | null;
}): boolean {
  return isProductMergeReferenceType(row.reference_type);
}

/** Rótulo e estilo do badge de tipo (entrada/saída vs unificação). */
export function stockMovementTypeDisplay(row: {
  type: string;
  reference_type: string | null;
  metadata_json?: StockMovementProductMergeMeta | null;
}): { kind: StockMovementTypeKind; label: string } {
  if (row.reference_type === "product_merge") {
    if (row.metadata_json?.undone_at) {
      return { kind: "merge", label: "Unificação (desfeita)" };
    }
    return { kind: "merge", label: "Unificação" };
  }
  if (row.reference_type === "product_merge_undo") {
    return { kind: "merge_undo", label: "Desfazer unificação" };
  }
  if (row.type === "in") return { kind: "in", label: "Entrada" };
  if (isWasteStockMovement(row)) return { kind: "waste", label: "Saída" };
  return { kind: "out", label: "Saída" };
}

export type StockMovementMergePairDisplay = {
  loserName: string;
  winnerName: string;
  undo: boolean;
  undone: boolean;
};

export function stockMovementMergePairDisplay(
  row: {
    reference_type: string | null;
    metadata_json?: StockMovementProductMergeMeta | null;
  },
  winnerName: string,
): StockMovementMergePairDisplay | null {
  const winner = winnerName.trim();
  if (!winner) return null;

  const loser = row.metadata_json?.loser_name?.trim();
  if (!loser) return null;

  if (row.reference_type === "product_merge") {
    return {
      loserName: loser,
      winnerName: winner,
      undo: false,
      undone: Boolean(row.metadata_json?.undone_at),
    };
  }
  if (row.reference_type === "product_merge_undo") {
    return {
      loserName: loser,
      winnerName: winner,
      undo: true,
      undone: false,
    };
  }
  return null;
}

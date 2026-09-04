import { describe, expect, it } from "vitest";
import {
  stockMovementMergePairDisplay,
  stockMovementTypeDisplay,
} from "@/lib/stockMovementMergeDisplay";

describe("stockMovementTypeDisplay", () => {
  it("uses merge labels instead of entrada/saída", () => {
    expect(
      stockMovementTypeDisplay({
        type: "in",
        reference_type: "product_merge",
        metadata_json: { loser_name: "A" },
      }),
    ).toEqual({ kind: "merge", label: "Unificação" });

    expect(
      stockMovementTypeDisplay({
        type: "out",
        reference_type: "product_merge_undo",
        metadata_json: { loser_name: "A" },
      }),
    ).toEqual({ kind: "merge_undo", label: "Desfazer unificação" });
  });

  it("keeps entrada/saída for normal movements", () => {
    expect(
      stockMovementTypeDisplay({ type: "in", reference_type: "expense_item" }),
    ).toEqual({ kind: "in", label: "Entrada" });
    expect(
      stockMovementTypeDisplay({ type: "out", reference_type: "revenue_entry" }),
    ).toEqual({ kind: "out", label: "Saída" });
  });

  it("identifies inventory count as entrada/saída por contagem", () => {
    expect(
      stockMovementTypeDisplay({
        type: "in",
        reference_type: "inventory_count",
      }),
    ).toEqual({ kind: "in", label: "Entrada por contagem" });
    expect(
      stockMovementTypeDisplay({
        type: "out",
        reference_type: "inventory_count",
      }),
    ).toEqual({ kind: "out", label: "Saída por contagem" });
  });
});

describe("stockMovementMergePairDisplay", () => {
  it("shows loser to winner on merge", () => {
    expect(
      stockMovementMergePairDisplay(
        {
          reference_type: "product_merge",
          metadata_json: { loser_name: "Coca 2L" },
        },
        "Coca Zero",
      ),
    ).toEqual({
      loserName: "Coca 2L",
      winnerName: "Coca Zero",
      undo: false,
      undone: false,
    });
  });

  it("marks undo direction", () => {
    expect(
      stockMovementMergePairDisplay(
        {
          reference_type: "product_merge_undo",
          metadata_json: { loser_name: "Coca 2L" },
        },
        "Coca Zero",
      )?.undo,
    ).toBe(true);
  });
});

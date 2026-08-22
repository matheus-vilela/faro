import { describe, expect, it } from "vitest";
import { isPendingReconLine, isReconciledReconLine, isIgnoredReconLine } from "./reconLineStatus";

describe("reconLineStatus", () => {
  it("só unmatched fica pendente", () => {
    expect(isPendingReconLine({ status: "unmatched" })).toBe(true);
    expect(isPendingReconLine({ status: "ignored" })).toBe(false);
    expect(isPendingReconLine({ status: "matched" })).toBe(false);
    expect(isPendingReconLine({ status: "created_payable" })).toBe(false);
  });

  it("matched e created_payable são conciliados", () => {
    expect(isReconciledReconLine({ status: "matched" })).toBe(true);
    expect(isReconciledReconLine({ status: "created_payable" })).toBe(true);
    expect(isReconciledReconLine({ status: "unmatched" })).toBe(false);
    expect(isReconciledReconLine({ status: "ignored" })).toBe(false);
  });

  it("ignored não entra na fila nem nos conciliados", () => {
    expect(isIgnoredReconLine({ status: "ignored" })).toBe(true);
    expect(isIgnoredReconLine({ status: "unmatched" })).toBe(false);
    expect(isPendingReconLine({ status: "ignored" })).toBe(false);
    expect(isReconciledReconLine({ status: "ignored" })).toBe(false);
  });
});

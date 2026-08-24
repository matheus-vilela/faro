import type { BankStatementLine } from "@/types/bankReconciliation";

export function isPendingReconLine(
  line: Pick<BankStatementLine, "status">,
): boolean {
  return line.status === "unmatched";
}

export function isReconciledReconLine(
  line: Pick<BankStatementLine, "status">,
): boolean {
  return line.status === "matched" || line.status === "created_payable";
}

export function isIgnoredReconLine(
  line: Pick<BankStatementLine, "status">,
): boolean {
  return line.status === "ignored";
}

import type { ParsedBankTransaction } from "@/types/bankReconciliation";

/** Chave de dedupe: FITID (OFX) ou hash estável data+valor+descrição+direção. */
export function buildDedupeKey(
  tx: ParsedBankTransaction,
  companyBankAccountId: string,
): string {
  const fit = tx.fitid?.trim();
  if (fit) return `fitid:${fit}`;

  const desc = (tx.description ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const amt = tx.amount.toFixed(2);
  return `h:${companyBankAccountId}|${tx.postedAt}|${amt}|${tx.direction}|${desc}`;
}

export function dedupeParsedTransactions(
  txs: ParsedBankTransaction[],
  companyBankAccountId: string,
): ParsedBankTransaction[] {
  const seen = new Set<string>();
  const out: ParsedBankTransaction[] = [];
  for (const tx of txs) {
    const key = buildDedupeKey(tx, companyBankAccountId);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tx);
  }
  return out;
}

/** Remove movimentos cuja chave já existe na conta (outros imports). */
export function filterNewParsedTransactions(
  txs: ParsedBankTransaction[],
  companyBankAccountId: string,
  existingKeys: ReadonlySet<string>,
): { fresh: ParsedBankTransaction[]; skippedCount: number } {
  const fresh: ParsedBankTransaction[] = [];
  let skippedCount = 0;
  for (const tx of txs) {
    const key = buildDedupeKey(tx, companyBankAccountId);
    if (existingKeys.has(key)) {
      skippedCount += 1;
      continue;
    }
    fresh.push(tx);
  }
  return { fresh, skippedCount };
}

export function filterDebits(
  txs: ParsedBankTransaction[],
): ParsedBankTransaction[] {
  return txs.filter((t) => t.direction === "debit");
}

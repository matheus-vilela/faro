import { describe, expect, it } from "vitest";
import {
  buildDedupeKey,
  dedupeParsedTransactions,
  filterDebits,
  filterNewParsedTransactions,
} from "./dedupe";
import type { ParsedBankTransaction } from "@/types/bankReconciliation";

describe("dedupe", () => {
  it("usa FITID quando presente", () => {
    const tx: ParsedBankTransaction = {
      postedAt: "2026-07-08",
      amount: 100,
      direction: "debit",
      description: "x",
      fitid: "ABC123",
    };
    expect(buildDedupeKey(tx, "acc-1")).toBe("fitid:ABC123");
  });

  it("remove duplicatas e filtra débitos", () => {
    const txs: ParsedBankTransaction[] = [
      {
        postedAt: "2026-07-08",
        amount: 100,
        direction: "debit",
        description: "PIX FOO",
        fitid: "1",
      },
      {
        postedAt: "2026-07-08",
        amount: 100,
        direction: "debit",
        description: "PIX FOO",
        fitid: "1",
      },
      {
        postedAt: "2026-07-09",
        amount: 50,
        direction: "credit",
        description: "Rendimento",
        fitid: "2",
      },
    ];
    const deduped = dedupeParsedTransactions(txs, "acc");
    expect(deduped).toHaveLength(2);
    expect(filterDebits(deduped)).toHaveLength(1);
  });

  it("pula chaves já existentes na conta", () => {
    const txs: ParsedBankTransaction[] = [
      {
        postedAt: "2026-07-08",
        amount: 100,
        direction: "debit",
        description: "PIX FOO",
        fitid: "1",
      },
      {
        postedAt: "2026-07-09",
        amount: 50,
        direction: "credit",
        description: "Rendimento",
        fitid: "2",
      },
    ];
    const existing = new Set(["fitid:1"]);
    const { fresh, skippedCount } = filterNewParsedTransactions(
      txs,
      "acc",
      existing,
    );
    expect(skippedCount).toBe(1);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]?.fitid).toBe("2");
  });
});

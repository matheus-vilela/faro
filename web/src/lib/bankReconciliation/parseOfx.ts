import type {
  BankStatementLineDirection,
  ParsedBankTransaction,
} from "@/types/bankReconciliation";

/** Extrai YYYY-MM-DD de datas OFX (YYYYMMDDHHMMSS[tz] ou YYYYMMDD). */
export function parseOfxDate(raw: string): string | null {
  const s = raw.trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function extractTagValue(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<\\r\\n]+)`, "i");
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

export type OfxLedgerBalance = {
  amount: number;
  asOfYmd: string | null;
};

function extractBalanceBlock(text: string, tag: string): string | null {
  const start = text.search(new RegExp(`<${tag}>`, "i"));
  if (start < 0) return null;
  const after = text.slice(start);
  const close = after.search(new RegExp(`</${tag}>`, "i"));
  if (close >= 0) return after.slice(0, close);
  return after.slice(0, 500);
}

function parseBalAmount(raw: string): number | null {
  const n = parseFloat(raw.replace(",", ".").trim());
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/** LEDGERBAL do OFX; se ausente, AVAILBAL. */
export function parseOfxLedgerBalance(content: string): OfxLedgerBalance | null {
  const text = content.replace(/^\uFEFF/, "");
  const block =
    extractBalanceBlock(text, "LEDGERBAL") ??
    extractBalanceBlock(text, "AVAILBAL");
  if (!block) return null;

  const amtRaw = extractTagValue(block, "BALAMT");
  if (!amtRaw) return null;
  const amount = parseBalAmount(amtRaw);
  if (amount === null) return null;

  const dtRaw = extractTagValue(block, "DTASOF");
  return {
    amount,
    asOfYmd: dtRaw ? parseOfxDate(dtRaw) : null,
  };
}

function parseTrnAmount(
  raw: string,
): { amount: number; signed: number } | null {
  const n = parseFloat(raw.replace(",", ".").trim());
  if (!Number.isFinite(n) || n === 0) return null;
  return { amount: Math.round(Math.abs(n) * 100) / 100, signed: n };
}

function directionFromOfx(
  trnType: string | null,
  signedAmount: number,
): BankStatementLineDirection {
  const t = (trnType ?? "").toUpperCase();
  if (t === "DEBIT" || t === "PAYMENT" || t === "CHECK" || t === "POS" || t === "ATM") {
    return "debit";
  }
  if (t === "CREDIT" || t === "DEP" || t === "DIRECTDEP" || t === "INT" || t === "DIV") {
    return "credit";
  }
  return signedAmount < 0 ? "debit" : "credit";
}

/**
 * Parser tolerante a OFX1 SGML (estilo BTG) e OFX2 XML.
 * Extrai STMTTRN com DTPOSTED, TRNAMT, TRNTYPE, MEMO/NAME, FITID.
 */
export function parseOfx(content: string): ParsedBankTransaction[] {
  const text = content.replace(/^\uFEFF/, "");
  const results: ParsedBankTransaction[] = [];

  // Split by STMTTRN blocks (opening tag); works for SGML and XML
  const parts = text.split(/<STMTTRN>/i);
  for (let i = 1; i < parts.length; i++) {
    let block = parts[i];
    const endIdx = block.search(/<\/STMTTRN>/i);
    if (endIdx >= 0) block = block.slice(0, endIdx);

    const dtRaw = extractTagValue(block, "DTPOSTED");
    const amtRaw = extractTagValue(block, "TRNAMT");
    if (!dtRaw || !amtRaw) continue;

    const postedAt = parseOfxDate(dtRaw);
    const parsedAmt = parseTrnAmount(amtRaw);
    if (!postedAt || !parsedAmt) continue;

    const trnType = extractTagValue(block, "TRNTYPE");
    const memo =
      extractTagValue(block, "MEMO") ??
      extractTagValue(block, "NAME") ??
      "";
    const fitid = extractTagValue(block, "FITID");
    const checkNum = extractTagValue(block, "CHECKNUM");

    results.push({
      postedAt,
      amount: parsedAmt.amount,
      direction: directionFromOfx(trnType, parsedAmt.signed),
      description: memo,
      fitid,
      checkNum,
      raw: {
        trnType,
        dtPosted: dtRaw,
        trnAmt: amtRaw,
        memo,
        fitid,
        checkNum,
      },
    });
  }

  return results;
}

import type { BankReconRowKind, BankMatchKind } from "@/types/bankReconciliation";

export interface MatchBoletoCandidate {
  id: string;
  description: string;
  amount: number;
  /** paid_at se pago, senão due_date */
  referenceDate: string;
  status: "pending" | "paid";
  company_category_id?: string | null;
}

export interface MatchStatementLine {
  id: string;
  postedAt: string;
  amount: number;
  description: string;
}

export interface MatchPairSuggestion {
  kind: Extract<BankReconRowKind, "forte" | "provavel">;
  matchKind: Extract<BankMatchKind, "forte" | "probable">;
  lineId: string;
  boletoId: string;
  confidence: number;
  amountDiff: number;
  dayDiff: number;
  /** Juros sugeridos quando banco > boleto */
  suggestedInterest: number;
  /** Desconto sugerido quando banco < boleto */
  suggestedDiscount: number;
}

export interface MatchResult {
  pairs: MatchPairSuggestion[];
  sobancoLineIds: string[];
  sofaroBoletoIds: string[];
}

const MS_PER_DAY = 86400000;

/** Máx. diferença de valor (R$) para considerar juros/ajuste em match provável. */
export const PROBABLE_MAX_AMOUNT_DIFF = 50;

/** Máx. dias de diferença para candidato a match (fora do caso fim de semana). */
export const PROBABLE_MAX_DAY_DIFF = 5;

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function dayDiffAbs(a: string, b: string): number {
  const da = parseYmd(a);
  const db = parseYmd(b);
  return Math.round(Math.abs(da.getTime() - db.getTime()) / MS_PER_DAY);
}

function isWeekend(ymd: string): boolean {
  const dow = parseYmd(ymd).getDay();
  return dow === 0 || dow === 6;
}

/**
 * Match forte: mesmo valor (centavos) e mesmo dia,
 * ou até 2 dias se o vencimento cair em fim de semana (pagamento no próximo dia útil).
 */
export function isStrongDateMatch(
  boletoRefDate: string,
  bankPostedAt: string,
): boolean {
  const days = dayDiffAbs(boletoRefDate, bankPostedAt);
  if (days === 0) return true;
  if (days <= 2 && isWeekend(boletoRefDate)) return true;
  return false;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function amountsEqual(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

/**
 * Score 0–100: quanto mais perto de data e valor, maior.
 */
export function scoreProximity(
  dayDiff: number,
  amountDiff: number,
  boletoAmount: number,
): number {
  const dateScore = Math.max(0, 100 - dayDiff * 18);
  const rel =
    boletoAmount > 0 ? amountDiff / boletoAmount : amountDiff > 0 ? 1 : 0;
  const amountScore = Math.max(0, 100 - rel * 200 - amountDiff * 2);
  return Math.round(dateScore * 0.55 + amountScore * 0.45);
}

export function buildMatchResult(
  lines: MatchStatementLine[],
  boletos: MatchBoletoCandidate[],
): MatchResult {
  const usedLines = new Set<string>();
  const usedBoletos = new Set<string>();
  const pairs: MatchPairSuggestion[] = [];

  type Scored = {
    line: MatchStatementLine;
    boleto: MatchBoletoCandidate;
    dayDiff: number;
    amountDiff: number;
    confidence: number;
    strong: boolean;
  };

  const candidates: Scored[] = [];

  for (const line of lines) {
    for (const boleto of boletos) {
      const dayDiff = dayDiffAbs(boleto.referenceDate, line.postedAt);
      const amountDiff = round2(Math.abs(line.amount - boleto.amount));
      const sameAmount = amountsEqual(line.amount, boleto.amount);
      const strongDate = isStrongDateMatch(boleto.referenceDate, line.postedAt);

      if (sameAmount && strongDate) {
        candidates.push({
          line,
          boleto,
          dayDiff,
          amountDiff: 0,
          confidence: 100,
          strong: true,
        });
        continue;
      }

      if (dayDiff > PROBABLE_MAX_DAY_DIFF) continue;
      if (amountDiff > PROBABLE_MAX_AMOUNT_DIFF) continue;
      // Precisa de alguma proximidade razoável
      if (!sameAmount && dayDiff > 3) continue;

      const confidence = scoreProximity(dayDiff, amountDiff, boleto.amount);
      if (confidence < 40) continue;

      candidates.push({
        line,
        boleto,
        dayDiff,
        amountDiff,
        confidence,
        strong: false,
      });
    }
  }

  // Prefer strong, then higher confidence, then smaller dayDiff
  candidates.sort((a, b) => {
    if (a.strong !== b.strong) return a.strong ? -1 : 1;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (a.dayDiff !== b.dayDiff) return a.dayDiff - b.dayDiff;
    return a.amountDiff - b.amountDiff;
  });

  for (const c of candidates) {
    if (usedLines.has(c.line.id) || usedBoletos.has(c.boleto.id)) continue;
    usedLines.add(c.line.id);
    usedBoletos.add(c.boleto.id);

    const bankMore = c.line.amount > c.boleto.amount;
    const suggestedInterest = bankMore ? c.amountDiff : 0;
    const suggestedDiscount = !bankMore ? c.amountDiff : 0;

    pairs.push({
      kind: c.strong ? "forte" : "provavel",
      matchKind: c.strong ? "forte" : "probable",
      lineId: c.line.id,
      boletoId: c.boleto.id,
      confidence: c.confidence,
      amountDiff: c.amountDiff,
      dayDiff: c.dayDiff,
      suggestedInterest,
      suggestedDiscount,
    });
  }

  const sobancoLineIds = lines
    .filter((l) => !usedLines.has(l.id))
    .map((l) => l.id);
  const sofaroBoletoIds = boletos
    .filter((b) => !usedBoletos.has(b.id) && b.status === "pending")
    .map((b) => b.id);

  return { pairs, sobancoLineIds, sofaroBoletoIds };
}

export function buildMatchResultByDirection(params: {
  debitLines: MatchStatementLine[];
  creditLines: MatchStatementLine[];
  payables: MatchBoletoCandidate[];
  receivables: MatchBoletoCandidate[];
}): MatchResult {
  const debit = buildMatchResult(params.debitLines, params.payables);
  const credit = buildMatchResult(params.creditLines, params.receivables);
  return {
    pairs: [...debit.pairs, ...credit.pairs],
    sobancoLineIds: [...debit.sobancoLineIds, ...credit.sobancoLineIds],
    sofaroBoletoIds: [...debit.sofaroBoletoIds, ...credit.sofaroBoletoIds],
  };
}

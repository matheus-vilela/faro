import type { MonthYear } from "@/components/MonthSelector";
import { isScheduledPayableBoleto } from "@/lib/payableBoletoReceipt";
import type { FluxoBoletoRow } from "@/types/expenseSeries";

export type PayableTotalBucket = {
  amount: number;
  count: number;
};

export type PayableTotals = {
  toPayInMonth: PayableTotalBucket;
  dueInNext7Days: PayableTotalBucket;
  overdue: PayableTotalBucket;
  paidInMonth: PayableTotalBucket;
};

const EMPTY_BUCKET: PayableTotalBucket = { amount: 0, count: 0 };

export const EMPTY_PAYABLE_TOTALS: PayableTotals = {
  toPayInMonth: EMPTY_BUCKET,
  dueInNext7Days: EMPTY_BUCKET,
  overdue: EMPTY_BUCKET,
  paidInMonth: EMPTY_BUCKET,
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymdParts(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return [y || 1970, m || 1, d || 1];
}

/** Início e fim do mês em YYYY-MM-DD (calendário local). */
export function getMonthYmdRange(
  month: number,
  year: number,
): { startYmd: string; endYmd: string } {
  const lastDay = new Date(year, month, 0).getDate();
  return {
    startYmd: `${year}-${pad2(month)}-01`,
    endYmd: `${year}-${pad2(month)}-${pad2(lastDay)}`,
  };
}

/** Soma dias em calendário local a uma data YYYY-MM-DD. */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymdParts(ymd);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

/** Desloca meses a partir de YYYY-MM-DD (mantém o dia quando possível). */
export function shiftMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymdParts(ymd);
  const dt = new Date(y, m - 1 + months, d);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

/** Intervalo união: mês filtrado ∪ [hoje−24m, hoje+6d]. */
export function getPayableTotalsFetchRange(
  period: MonthYear,
  todayYmd: string,
): { startYmd: string; endYmd: string } {
  const { startYmd: monthStart, endYmd: monthEnd } = getMonthYmdRange(
    period.month,
    period.year,
  );
  const lookbackStart = shiftMonthsYmd(todayYmd, -24);
  const sevenEnd = addDaysYmd(todayYmd, 6);
  return {
    startYmd: monthStart < lookbackStart ? monthStart : lookbackStart,
    endYmd: monthEnd > sevenEnd ? monthEnd : sevenEnd,
  };
}

/** Nome do mês em pt-BR minúsculo (ex.: "julho"). */
export function formatPayableMonthName(month: number, year: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
  });
}

function accumulate(
  bucket: PayableTotalBucket,
  amount: number,
): PayableTotalBucket {
  return { amount: bucket.amount + amount, count: bucket.count + 1 };
}

export function computePayableTotals(
  boletos: Array<
    Pick<FluxoBoletoRow, "due_date" | "amount" | "status" | "is_projected">
  >,
  period: MonthYear,
  todayYmd: string,
): PayableTotals {
  const { startYmd: monthStart, endYmd: monthEnd } = getMonthYmdRange(
    period.month,
    period.year,
  );
  const sevenEnd = addDaysYmd(todayYmd, 6);

  let toPayInMonth = EMPTY_BUCKET;
  let dueInNext7Days = EMPTY_BUCKET;
  let overdue = EMPTY_BUCKET;
  let paidInMonth = EMPTY_BUCKET;

  for (const b of boletos) {
    const due = String(b.due_date ?? "").slice(0, 10);
    if (!due) continue;
    const amount = Number(b.amount) || 0;
    const scheduled = isScheduledPayableBoleto(b);
    const inMonth = due >= monthStart && due <= monthEnd;

    if (scheduled && inMonth) {
      toPayInMonth = accumulate(toPayInMonth, amount);
    }
    if (scheduled && due >= todayYmd && due <= sevenEnd) {
      dueInNext7Days = accumulate(dueInNext7Days, amount);
    }
    if (scheduled && due < todayYmd) {
      overdue = accumulate(overdue, amount);
    }
    if (b.status === "paid" && inMonth) {
      paidInMonth = accumulate(paidInMonth, amount);
    }
  }

  return { toPayInMonth, dueInNext7Days, overdue, paidInMonth };
}

export function formatContasCount(count: number): string {
  return count === 1 ? "1 conta" : `${count} contas`;
}

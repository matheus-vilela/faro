import { isBoletoPayable } from "@/types/expense";
import type { Boleto } from "@/types/expense";

export type CalendarDayTotals = {
  payable: number;
  receivable: number;
  payableReady: number;
  payablePendingReceipt: number;
  paid: number;
};

function payableAmount(b: Pick<Boleto, "amount">): number {
  return Number(b.amount) || 0;
}

function paidAmount(b: Pick<Boleto, "amount" | "paid_amount">): number {
  return Number(b.paid_amount ?? b.amount) || 0;
}

type CalendarDayBoleto = Pick<
  Boleto,
  "amount" | "paid_amount" | "flow_type" | "status"
> & { is_projected?: boolean };

export function calendarDayTotals<T extends CalendarDayBoleto>(
  items: T[],
  options?: {
    splitPayableByReceipt?: (b: T) => boolean;
    onlyScheduledPayables?: (b: T) => boolean;
  },
): CalendarDayTotals {
  let payable = 0;
  let receivable = 0;
  let payableReady = 0;
  let payablePendingReceipt = 0;
  let paid = 0;

  for (const b of items) {
    if (isBoletoPayable(b)) {
      if (options?.onlyScheduledPayables && !options.onlyScheduledPayables(b)) {
        paid += paidAmount(b);
        continue;
      }
      const amount = payableAmount(b);
      payable += amount;
      if (options?.splitPayableByReceipt) {
        if (options.splitPayableByReceipt(b)) payableReady += amount;
        else payablePendingReceipt += amount;
      } else {
        payableReady += amount;
      }
    } else {
      receivable += payableAmount(b);
    }
  }

  return { payable, receivable, payableReady, payablePendingReceipt, paid };
}

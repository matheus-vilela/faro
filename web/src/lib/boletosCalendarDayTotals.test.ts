import { describe, expect, it } from "vitest";
import { isScheduledPayableBoleto } from "./payableBoletoReceipt";
import { calendarDayTotals } from "./boletosCalendarDayTotals";

describe("calendarDayTotals", () => {
  it("soma contas pagas à parte quando só as agendadas entram em a pagar", () => {
    const totals = calendarDayTotals(
      [
        { amount: 100, paid_amount: null, flow_type: "payable", status: "pending" },
        { amount: 80, paid_amount: 82.5, flow_type: "payable", status: "paid" },
      ],
      { onlyScheduledPayables: isScheduledPayableBoleto },
    );

    expect(totals.payable).toBe(100);
    expect(totals.payableReady).toBe(100);
    expect(totals.paid).toBe(82.5);
  });

  it("usa o valor original quando a conta paga não tem paid_amount", () => {
    const totals = calendarDayTotals(
      [{ amount: 50, paid_amount: null, flow_type: "payable", status: "paid" }],
      { onlyScheduledPayables: isScheduledPayableBoleto },
    );

    expect(totals.payable).toBe(0);
    expect(totals.paid).toBe(50);
  });

  it("mantém projeções em a pagar, não em pago", () => {
    const totals = calendarDayTotals(
      [
        {
          amount: 200,
          paid_amount: null,
          flow_type: "payable",
          status: "pending",
          is_projected: true,
        },
      ],
      { onlyScheduledPayables: isScheduledPayableBoleto },
    );

    expect(totals.payable).toBe(200);
    expect(totals.paid).toBe(0);
  });
});

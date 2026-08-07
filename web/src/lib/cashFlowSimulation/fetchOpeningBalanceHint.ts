import { boletoCountsInCashFlow } from "@/lib/boletoFluxo";
import { addDaysYmd } from "@/lib/payableTotals";
import { supabase } from "@/lib/supabase";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import type { Boleto } from "@/types/expense";
import type { OpeningBalanceHint } from "./types";

type PaidBoletoRow = Pick<
  Boleto,
  | "flow_type"
  | "amount"
  | "paid_amount"
  | "paid_at"
  | "exclude_from_fluxo"
  | "description"
  | "entry_kind"
>;

type PendingOverdueRow = Pick<
  Boleto,
  | "flow_type"
  | "amount"
  | "due_date"
  | "exclude_from_fluxo"
  | "description"
  | "entry_kind"
>;

function paidAmount(b: PaidBoletoRow): number {
  const v = b.paid_amount ?? b.amount;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function sumPaidSince(input: {
  companyId: string;
  sinceYmd: string;
  flowType: "payable" | "receivable";
}): Promise<number> {
  const rows = await fetchAllInRange<PaidBoletoRow>(
    supabase
      .from("boletos")
      .select(
        "flow_type, amount, paid_amount, paid_at, exclude_from_fluxo, description, entry_kind",
      )
      .eq("company_id", input.companyId)
      .eq("flow_type", input.flowType)
      .eq("status", "paid")
      .neq("entry_kind", "transfer")
      .gte("paid_at", `${input.sinceYmd}T00:00:00`)
      .order("paid_at", { ascending: true }),
  );

  return rows.reduce((sum, row) => {
    if (!boletoCountsInCashFlow(row)) return sum;
    return sum + paidAmount(row);
  }, 0);
}

async function sumOverduePending(input: {
  companyId: string;
  todayYmd: string;
  flowType: "payable" | "receivable";
}): Promise<number> {
  const lookbackStart = addDaysYmd(input.todayYmd, -90);
  const rows = await fetchAllInRange<PendingOverdueRow>(
    supabase
      .from("boletos")
      .select(
        "flow_type, amount, due_date, exclude_from_fluxo, description, entry_kind",
      )
      .eq("company_id", input.companyId)
      .eq("flow_type", input.flowType)
      .eq("status", "pending")
      .eq("exclude_from_fluxo", false)
      .neq("entry_kind", "transfer")
      .gte("due_date", lookbackStart)
      .lt("due_date", input.todayYmd)
      .order("due_date", { ascending: true }),
  );

  return rows.reduce((sum, row) => {
    if (!boletoCountsInCashFlow(row)) return sum;
    const amount = Number(row.amount) || 0;
    return sum + amount;
  }, 0);
}

export async function fetchOpeningBalanceHint(input: {
  companyId: string;
  todayYmd: string;
  includePayables: boolean;
  includeReceivables: boolean;
}): Promise<OpeningBalanceHint> {
  const since30 = addDaysYmd(input.todayYmd, -30);

  const paidQueries: Promise<number>[] = [];
  if (input.includeReceivables) {
    paidQueries.push(
      sumPaidSince({
        companyId: input.companyId,
        sinceYmd: since30,
        flowType: "receivable",
      }),
    );
  }
  if (input.includePayables) {
    paidQueries.push(
      sumPaidSince({
        companyId: input.companyId,
        sinceYmd: since30,
        flowType: "payable",
      }),
    );
  }

  const overdueQueries: Promise<number>[] = [];
  if (input.includePayables) {
    overdueQueries.push(
      sumOverduePending({
        companyId: input.companyId,
        todayYmd: input.todayYmd,
        flowType: "payable",
      }),
    );
  }
  if (input.includeReceivables) {
    overdueQueries.push(
      sumOverduePending({
        companyId: input.companyId,
        todayYmd: input.todayYmd,
        flowType: "receivable",
      }),
    );
  }

  const [paidResults, overdueResults] = await Promise.all([
    Promise.all(paidQueries),
    Promise.all(overdueQueries),
  ]);

  let paidInflows30 = 0;
  let paidOutflows30 = 0;
  let pi = 0;
  if (input.includeReceivables) {
    paidInflows30 = paidResults[pi++] ?? 0;
  }
  if (input.includePayables) {
    paidOutflows30 = paidResults[pi++] ?? 0;
  }

  let overduePendingPayablesAmount = 0;
  let overduePendingReceivablesAmount = 0;
  let oi = 0;
  if (input.includePayables) {
    overduePendingPayablesAmount = overdueResults[oi++] ?? 0;
  }
  if (input.includeReceivables) {
    overduePendingReceivablesAmount = overdueResults[oi++] ?? 0;
  }

  return {
    paidInflows30,
    paidOutflows30,
    netPaid30: paidInflows30 - paidOutflows30,
    overduePendingPayablesAmount,
    overduePendingReceivablesAmount,
  };
}

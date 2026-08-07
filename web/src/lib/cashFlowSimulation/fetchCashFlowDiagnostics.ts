import { boletoCountsInCashFlow } from "@/lib/boletoFluxo";
import { addDaysYmd } from "@/lib/payableTotals";
import { supabase } from "@/lib/supabase";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import type { Boleto } from "@/types/expense";
import type { CashFlowDiagnostics, HorizonWeeks } from "./types";
import { getCashFlowFetchRange } from "./computeCashFlowProjection";

type PendingBoletoRow = Pick<
  Boleto,
  | "due_date"
  | "amount"
  | "flow_type"
  | "status"
  | "exclude_from_fluxo"
  | "description"
  | "entry_kind"
>;

async function countPendingOutsideHorizon(input: {
  companyId: string;
  horizonEnd: string;
  flowType: "payable" | "receivable";
}): Promise<number> {
  const { count, error } = await supabase
    .from("boletos")
    .select("id", { count: "exact", head: true })
    .eq("company_id", input.companyId)
    .eq("flow_type", input.flowType)
    .eq("status", "pending")
    .eq("exclude_from_fluxo", false)
    .neq("entry_kind", "transfer")
    .gt("due_date", input.horizonEnd);

  if (error) throw error;
  return count ?? 0;
}

async function fetchOverduePending(input: {
  companyId: string;
  todayYmd: string;
  includePayables: boolean;
  includeReceivables: boolean;
}): Promise<{
  count: number;
  payablesAmount: number;
  receivablesAmount: number;
}> {
  const lookbackStart = addDaysYmd(input.todayYmd, -90);
  const rows: PendingBoletoRow[] = [];

  const queries: Promise<PendingBoletoRow[]>[] = [];

  if (input.includePayables) {
    queries.push(
      fetchAllInRange<PendingBoletoRow>(
        supabase
          .from("boletos")
          .select(
            "due_date, amount, flow_type, status, exclude_from_fluxo, description, entry_kind",
          )
          .eq("company_id", input.companyId)
          .eq("flow_type", "payable")
          .eq("status", "pending")
          .neq("entry_kind", "transfer")
          .gte("due_date", lookbackStart)
          .lt("due_date", input.todayYmd)
          .order("due_date", { ascending: true }),
      ),
    );
  }

  if (input.includeReceivables) {
    queries.push(
      fetchAllInRange<PendingBoletoRow>(
        supabase
          .from("boletos")
          .select(
            "due_date, amount, flow_type, status, exclude_from_fluxo, description, entry_kind",
          )
          .eq("company_id", input.companyId)
          .eq("flow_type", "receivable")
          .eq("status", "pending")
          .eq("exclude_from_fluxo", false)
          .neq("entry_kind", "transfer")
          .gte("due_date", lookbackStart)
          .lt("due_date", input.todayYmd)
          .order("due_date", { ascending: true }),
      ),
    );
  }

  const chunks = await Promise.all(queries);
  for (const chunk of chunks) rows.push(...chunk);

  let count = 0;
  let payablesAmount = 0;
  let receivablesAmount = 0;

  for (const row of rows) {
    if (!boletoCountsInCashFlow(row)) continue;
    const amount = Number(row.amount) || 0;
    if (amount <= 0) continue;
    count += 1;
    if (row.flow_type === "receivable") {
      receivablesAmount += amount;
    } else {
      payablesAmount += amount;
    }
  }

  return { count, payablesAmount, receivablesAmount };
}

export async function fetchCashFlowDiagnostics(input: {
  companyId: string;
  todayYmd: string;
  horizonWeeks: HorizonWeeks;
  pendingInHorizon: number;
  includePayables: boolean;
  includeReceivables: boolean;
  weekStartsOn?: number;
}): Promise<CashFlowDiagnostics> {
  const { endYmd: horizonEnd } = getCashFlowFetchRange(
    input.todayYmd,
    input.horizonWeeks,
    input.weekStartsOn ?? 1,
  );

  const outsideQueries: Promise<number>[] = [];
  if (input.includePayables) {
    outsideQueries.push(
      countPendingOutsideHorizon({
        companyId: input.companyId,
        horizonEnd,
        flowType: "payable",
      }),
    );
  }
  if (input.includeReceivables) {
    outsideQueries.push(
      countPendingOutsideHorizon({
        companyId: input.companyId,
        horizonEnd,
        flowType: "receivable",
      }),
    );
  }

  const [outsideCounts, overdue] = await Promise.all([
    Promise.all(outsideQueries),
    fetchOverduePending({
      companyId: input.companyId,
      todayYmd: input.todayYmd,
      includePayables: input.includePayables,
      includeReceivables: input.includeReceivables,
    }),
  ]);

  return {
    pendingInHorizon: input.pendingInHorizon,
    pendingOutsideHorizon: outsideCounts.reduce((a, b) => a + b, 0),
    overduePendingCount: overdue.count,
    overduePendingPayablesAmount: overdue.payablesAmount,
    overduePendingReceivablesAmount: overdue.receivablesAmount,
  };
}

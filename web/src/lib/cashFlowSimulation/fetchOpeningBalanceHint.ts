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

  const [paidResults, overdueResults, bankCash] = await Promise.all([
    Promise.all(paidQueries),
    Promise.all(overdueQueries),
    fetchBankCashPosition(input.companyId),
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
    ...bankCash,
  };
}

async function fetchBankCashPosition(companyId: string): Promise<{
  accountsBalanceTotal: number;
  accountsWithBalanceCount: number;
  ofxBalanceTotal: number | null;
  ofxBalanceAsOfYmd: string | null;
  ofxAccountCount: number;
  ofxFileName: string | null;
}> {
  const empty = {
    accountsBalanceTotal: 0,
    accountsWithBalanceCount: 0,
    ofxBalanceTotal: null as number | null,
    ofxBalanceAsOfYmd: null as string | null,
    ofxAccountCount: 0,
    ofxFileName: null as string | null,
  };

  const [accountsRes, ofxRes] = await Promise.all([
    supabase
      .from("company_bank_accounts")
      .select("id, current_balance")
      .eq("company_id", companyId),
    supabase
      .from("bank_statement_imports")
      .select(
        "company_bank_account_id, ledger_balance, ledger_balance_as_of, file_name, created_at",
      )
      .eq("company_id", companyId)
      .eq("source_format", "ofx")
      .eq("status", "ready")
      .not("ledger_balance", "is", null)
      .order("created_at", { ascending: false }),
  ]);

  if (accountsRes.error) throw accountsRes.error;
  if (ofxRes.error) throw ofxRes.error;

  let accountsBalanceTotal = 0;
  let accountsWithBalanceCount = 0;
  for (const row of accountsRes.data ?? []) {
    const n = Number(row.current_balance);
    if (!Number.isFinite(n) || row.current_balance == null) continue;
    accountsBalanceTotal += n;
    accountsWithBalanceCount += 1;
  }

  const latestByAccount = new Map<
    string,
    { amount: number; asOf: string | null; fileName: string | null }
  >();
  for (const row of ofxRes.data ?? []) {
    const accountId = String(row.company_bank_account_id);
    if (latestByAccount.has(accountId)) continue;
    const n = Number(row.ledger_balance);
    if (!Number.isFinite(n)) continue;
    latestByAccount.set(accountId, {
      amount: n,
      asOf:
        typeof row.ledger_balance_as_of === "string"
          ? row.ledger_balance_as_of.slice(0, 10)
          : null,
      fileName:
        typeof row.file_name === "string" && row.file_name
          ? row.file_name
          : null,
    });
  }

  if (latestByAccount.size === 0) {
    return { ...empty, accountsBalanceTotal, accountsWithBalanceCount };
  }

  let ofxBalanceTotal = 0;
  let ofxBalanceAsOfYmd: string | null = null;
  let ofxFileName: string | null = null;
  for (const entry of latestByAccount.values()) {
    ofxBalanceTotal += entry.amount;
    if (entry.asOf && (!ofxBalanceAsOfYmd || entry.asOf > ofxBalanceAsOfYmd)) {
      ofxBalanceAsOfYmd = entry.asOf;
    }
    ofxFileName = entry.fileName;
  }

  return {
    accountsBalanceTotal,
    accountsWithBalanceCount,
    ofxBalanceTotal,
    ofxBalanceAsOfYmd,
    ofxAccountCount: latestByAccount.size,
    ofxFileName: latestByAccount.size === 1 ? ofxFileName : null,
  };
}

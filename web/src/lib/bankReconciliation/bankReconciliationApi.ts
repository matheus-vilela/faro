import { buildDedupeKey, dedupeParsedTransactions } from "@/lib/bankReconciliation/dedupe";
import { parseCsv } from "@/lib/bankReconciliation/parseCsv";
import { parseOfx, parseOfxLedgerBalance } from "@/lib/bankReconciliation/parseOfx";
import {
  competenceDateFromMonthInput,
  computePaidAmount,
  monthInputFromYmd,
} from "@/lib/boletoPayment";
import {
  pickLaunchMemoryFromHistory,
  type LaunchMemorySuggestion,
} from "@/lib/bankReconciliation/suggestLaunchFromHistory";
import { supabase } from "@/lib/supabase";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import type {
  BankCsvColumnMapping,
  BankMatchKind,
  BankStatementImport,
  BankStatementLine,
  BankStatementLineDirection,
  BankStatementSourceFormat,
  ParsedBankTransaction,
} from "@/types/bankReconciliation";
import type { Boleto, BoletoEntryKind, BoletoFlowType } from "@/types/expense";
import { isBoletoPayable } from "@/types/expense";

const BUCKET = "bank-statements";

function detectFormat(fileName: string): BankStatementSourceFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".ofx") || lower.endsWith(".qfx")) return "ofx";
  return "csv";
}

export function parseStatementFile(
  content: string,
  format: BankStatementSourceFormat,
  csvMapping?: BankCsvColumnMapping | null,
): ParsedBankTransaction[] {
  if (format === "ofx") return parseOfx(content);
  return parseCsv(content, csvMapping).transactions;
}

async function applyOfxLedgerToAccount(params: {
  companyBankAccountId: string;
  amount: number;
  asOfYmd: string | null;
}): Promise<boolean> {
  const { companyBankAccountId, amount, asOfYmd } = params;
  const { data: account, error: fetchErr } = await supabase
    .from("company_bank_accounts")
    .select("id, balance_as_of")
    .eq("id", companyBankAccountId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!account) return false;

  const existingAsOf =
    typeof account.balance_as_of === "string"
      ? account.balance_as_of.slice(0, 10)
      : null;
  if (existingAsOf && asOfYmd && existingAsOf > asOfYmd) {
    return false;
  }

  const { error: updErr } = await supabase
    .from("company_bank_accounts")
    .update({
      current_balance: amount,
      balance_as_of: asOfYmd,
    })
    .eq("id", companyBankAccountId);
  if (updErr) throw updErr;
  return true;
}

export async function uploadAndImportStatement(params: {
  companyId: string;
  companyBankAccountId: string;
  file: File;
  userId: string | null;
  csvMapping?: BankCsvColumnMapping | null;
}): Promise<{
  importRow: BankStatementImport;
  lines: BankStatementLine[];
  ofxLedgerApplied: boolean;
  ofxLedgerAmount: number | null;
}> {
  const { companyId, companyBankAccountId, file, userId, csvMapping } = params;
  const format = detectFormat(file.name);
  const content = await file.text();
  const parsed = dedupeParsedTransactions(
    parseStatementFile(content, format, csvMapping),
    companyBankAccountId,
  );
  const ofxLedger =
    format === "ofx" ? parseOfxLedgerBalance(content) : null;

  const stamp = Date.now();
  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const storagePath = `${companyId}/${companyBankAccountId}/${stamp}_${safeName}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      upsert: false,
      contentType: file.type || "application/octet-stream",
    });
  if (upErr) throw upErr;

  const dates = parsed.map((p) => p.postedAt).sort();
  const periodStart = dates[0] ?? null;
  const periodEnd = dates[dates.length - 1] ?? null;
  const ledgerAsOf = ofxLedger?.asOfYmd ?? periodEnd;

  const { data: importRow, error: impErr } = await supabase
    .from("bank_statement_imports")
    .insert({
      company_id: companyId,
      company_bank_account_id: companyBankAccountId,
      source_format: format,
      file_name: file.name,
      storage_path: storagePath,
      period_start: periodStart,
      period_end: periodEnd,
      status: "ready",
      row_count: parsed.length,
      ledger_balance: ofxLedger?.amount ?? null,
      ledger_balance_as_of: ofxLedger ? ledgerAsOf : null,
      created_by: userId,
    })
    .select("*")
    .single();
  if (impErr) throw impErr;

  let ofxLedgerApplied = false;
  if (ofxLedger) {
    ofxLedgerApplied = await applyOfxLedgerToAccount({
      companyBankAccountId,
      amount: ofxLedger.amount,
      asOfYmd: ledgerAsOf,
    });
  }

  const resultMeta = {
    ofxLedgerApplied,
    ofxLedgerAmount: ofxLedger?.amount ?? null,
  };

  if (parsed.length === 0) {
    return {
      importRow: importRow as BankStatementImport,
      lines: [],
      ...resultMeta,
    };
  }

  const lineRows = parsed.map((tx) => ({
    import_id: importRow.id,
    company_id: companyId,
    posted_at: tx.postedAt,
    amount: tx.amount,
    direction: tx.direction,
    description: tx.description,
    fitid: tx.fitid ?? null,
    dedupe_key: buildDedupeKey(tx, companyBankAccountId),
    raw_json: tx.raw ?? null,
    status: "unmatched",
  }));

  const { data: lines, error: lineErr } = await supabase
    .from("bank_statement_lines")
    .insert(lineRows)
    .select("*");
  if (lineErr) throw lineErr;

  return {
    importRow: importRow as BankStatementImport,
    lines: (lines ?? []) as BankStatementLine[],
    ...resultMeta,
  };
}

export async function fetchLatestImport(
  companyId: string,
  companyBankAccountId: string,
): Promise<BankStatementImport | null> {
  const { data, error } = await supabase
    .from("bank_statement_imports")
    .select("*")
    .eq("company_id", companyId)
    .eq("company_bank_account_id", companyBankAccountId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as BankStatementImport | null;
}

export async function fetchImportLines(
  importId: string,
): Promise<BankStatementLine[]> {
  const { data, error } = await supabase
    .from("bank_statement_lines")
    .select("*")
    .eq("import_id", importId)
    .order("posted_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as BankStatementLine[];
}

export function isPendingReconLine(
  line: Pick<BankStatementLine, "status" | "direction">,
): boolean {
  if (line.status === "unmatched") return true;
  return line.direction === "credit" && line.status === "ignored";
}

export async function fetchBoletosForRecon(
  companyId: string,
  periodStart: string,
  periodEnd: string,
): Promise<Boleto[]> {
  // Ampliar janela ±7 dias para cobrir fim de semana / atraso
  const start = shiftYmd(periodStart, -7);
  const end = shiftYmd(periodEnd, 7);

  const { data, error } = await supabase
    .from("boletos")
    .select("*, supplier:suppliers(id, name)")
    .eq("company_id", companyId)
    .or(
      `and(status.eq.pending,due_date.gte.${start},due_date.lte.${end}),and(status.eq.paid,paid_at.gte.${start},paid_at.lte.${end})`,
    );
  if (error) throw error;
  return (data ?? []) as Boleto[];
}

/** @deprecated Use fetchBoletosForRecon — a conciliação agora inclui pagar e receber. */
export async function fetchPayableBoletosForRecon(
  companyId: string,
  periodStart: string,
  periodEnd: string,
): Promise<Boleto[]> {
  return fetchBoletosForRecon(companyId, periodStart, periodEnd);
}

function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function boletoReferenceDate(b: Pick<Boleto, "paid_at" | "due_date" | "status">): string {
  if (b.status === "paid" && b.paid_at) return b.paid_at.slice(0, 10);
  return b.due_date.slice(0, 10);
}

export async function confirmReconciliation(params: {
  companyId: string;
  userId: string | null;
  statementLineId: string;
  boletoId: string;
  matchKind: BankMatchKind;
  confidence: number | null;
  amountDiff: number;
  companyBankAccountId: string;
  paymentDate: string;
  interestAmount?: number;
  discountAmount?: number;
}): Promise<Boleto> {
  const {
    companyId,
    userId,
    statementLineId,
    boletoId,
    matchKind,
    confidence,
    amountDiff,
    companyBankAccountId,
    paymentDate,
    interestAmount = 0,
    discountAmount = 0,
  } = params;

  const { data: boleto, error: fetchErr } = await supabase
    .from("boletos")
    .select("*")
    .eq("id", boletoId)
    .eq("company_id", companyId)
    .single();
  if (fetchErr) throw fetchErr;

  const original = Number(boleto.amount) || 0;
  const paidAmount = computePaidAmount(original, interestAmount, discountAmount);
  const competenceDate =
    competenceDateFromMonthInput(monthInputFromYmd(paymentDate)) ||
    `${paymentDate.slice(0, 7)}-01`;

  const alreadyPaid = boleto.status === "paid";

  if (!alreadyPaid) {
    const { error: payErr } = await supabase
      .from("boletos")
      .update({
        status: "paid",
        paid_at: paymentDate.slice(0, 10),
        competence_date: competenceDate,
        company_bank_account_id: companyBankAccountId,
        interest_amount: interestAmount,
        discount_amount: discountAmount,
        paid_amount: paidAmount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", boletoId)
      .eq("company_id", companyId);
    if (payErr) throw payErr;
  }

  const { error: reconErr } = await supabase.from("bank_reconciliations").insert({
    company_id: companyId,
    statement_line_id: statementLineId,
    boleto_id: boletoId,
    match_kind: matchKind,
    confidence,
    amount_diff: amountDiff,
    reconciled_by: userId,
  });
  if (reconErr) throw reconErr;

  const { error: lineErr } = await supabase
    .from("bank_statement_lines")
    .update({ status: "matched" })
    .eq("id", statementLineId)
    .eq("company_id", companyId);
  if (lineErr) throw lineErr;

  const { data: updated, error: reloadErr } = await supabase
    .from("boletos")
    .select("*")
    .eq("id", boletoId)
    .single();
  if (reloadErr) throw reloadErr;
  return updated as Boleto;
}

export async function markLineCreatedPayable(params: {
  companyId: string;
  statementLineId: string;
  boletoId: string;
  userId: string | null;
  companyBankAccountId: string;
  paymentDate: string;
  statementDirection?: BankStatementLineDirection;
}): Promise<void> {
  const {
    companyId,
    statementLineId,
    boletoId,
    userId,
    companyBankAccountId,
    paymentDate,
    statementDirection,
  } = params;

  const { data: boleto, error: fetchErr } = await supabase
    .from("boletos")
    .select("*")
    .eq("id", boletoId)
    .eq("company_id", companyId)
    .single();
  if (fetchErr) throw fetchErr;

  let target = boleto as Boleto;
  let groupRows: Boleto[] = [target];

  if (target.entry_kind === "transfer" && target.transfer_group_id) {
    const { data: legs, error: legsErr } = await supabase
      .from("boletos")
      .select("*")
      .eq("company_id", companyId)
      .eq("transfer_group_id", target.transfer_group_id)
      .eq("entry_kind", "transfer");
    if (legsErr) throw legsErr;
    groupRows = (legs ?? []) as Boleto[];
    const wantFlow =
      statementDirection === "credit" ? "receivable" : "payable";
    target =
      groupRows.find((b) =>
        wantFlow === "receivable" ? !isBoletoPayable(b) : isBoletoPayable(b),
      ) ?? target;
  }

  const competenceDate =
    competenceDateFromMonthInput(monthInputFromYmd(paymentDate)) ||
    `${paymentDate.slice(0, 7)}-01`;
  const paidAt = paymentDate.slice(0, 10);
  const updatedAt = new Date().toISOString();

  for (const row of groupRows) {
    if (row.status === "paid") continue;
    const original = Number(row.amount) || 0;
    const { error: payErr } = await supabase
      .from("boletos")
      .update({
        status: "paid",
        paid_at: paidAt,
        competence_date: competenceDate,
        company_bank_account_id:
          row.company_bank_account_id ?? companyBankAccountId,
        interest_amount: 0,
        discount_amount: 0,
        paid_amount: original,
        updated_at: updatedAt,
      })
      .eq("id", row.id)
      .eq("company_id", companyId);
    if (payErr) throw payErr;
  }

  const { error: reconErr } = await supabase.from("bank_reconciliations").insert({
    company_id: companyId,
    statement_line_id: statementLineId,
    boleto_id: target.id,
    match_kind: "manual",
    confidence: null,
    amount_diff: 0,
    reconciled_by: userId,
  });
  if (reconErr) throw reconErr;

  const { error: lineErr } = await supabase
    .from("bank_statement_lines")
    .update({ status: "created_payable" })
    .eq("id", statementLineId)
    .eq("company_id", companyId);
  if (lineErr) throw lineErr;
}

export async function searchBoletosForAssociate(params: {
  companyId: string;
  query: string;
  flowType: BoletoFlowType;
  excludeIds: string[];
}): Promise<Boleto[]> {
  const q = params.query.trim();
  let request = supabase
    .from("boletos")
    .select("*, supplier:suppliers(id, name)")
    .eq("company_id", params.companyId)
    .eq("flow_type", params.flowType)
    .order("due_date", { ascending: false })
    .limit(50);
  if (q) {
    request = request.ilike("description", `%${q}%`);
  }
  const { data, error } = await request;
  if (error) throw error;
  const exclude = new Set(params.excludeIds);
  return ((data ?? []) as Boleto[]).filter((b) => !exclude.has(b.id));
}

export async function suggestLaunchFromStatementHistory(params: {
  companyId: string;
  bankDescription: string;
  preferEntryKind?: BoletoEntryKind;
  preferFlowType?: BoletoFlowType;
}): Promise<LaunchMemorySuggestion | null> {
  const { data: lines, error: linesErr } = await supabase
    .from("bank_statement_lines")
    .select("id, description, updated_at")
    .eq("company_id", params.companyId)
    .in("status", ["matched", "created_payable"])
    .order("updated_at", { ascending: false })
    .limit(200);
  if (linesErr) throw linesErr;
  const historyLines = lines ?? [];
  if (historyLines.length === 0) return null;

  const lineIds = historyLines.map((l) => l.id as string);
  const { data: recons, error: reconErr } = await supabase
    .from("bank_reconciliations")
    .select("statement_line_id, boleto_id")
    .eq("company_id", params.companyId)
    .in("statement_line_id", lineIds);
  if (reconErr) throw reconErr;

  const boletoIds = [
    ...new Set((recons ?? []).map((r) => r.boleto_id as string)),
  ];
  if (boletoIds.length === 0) return null;

  const { data: boletos, error: bolErr } = await supabase
    .from("boletos")
    .select(
      "id, description, flow_type, entry_kind, company_category_id, company_bank_account_id, transfer_group_id",
    )
    .eq("company_id", params.companyId)
    .in("id", boletoIds);
  if (bolErr) throw bolErr;

  const boletoById = new Map(
    ((boletos ?? []) as Boleto[]).map((b) => [b.id, b]),
  );
  const boletoIdByLine = new Map<string, string>();
  for (const r of recons ?? []) {
    boletoIdByLine.set(r.statement_line_id as string, r.boleto_id as string);
  }

  const transferGroupIds = [
    ...new Set(
      ((boletos ?? []) as Boleto[])
        .filter((b) => b.entry_kind === "transfer" && b.transfer_group_id)
        .map((b) => b.transfer_group_id as string),
    ),
  ];
  const counterpartByGroup = new Map<string, Boleto[]>();
  if (transferGroupIds.length > 0) {
    const { data: legs, error: legsErr } = await supabase
      .from("boletos")
      .select("id, flow_type, company_bank_account_id, transfer_group_id")
      .eq("company_id", params.companyId)
      .in("transfer_group_id", transferGroupIds);
    if (legsErr) throw legsErr;
    for (const leg of (legs ?? []) as Boleto[]) {
      const gid = leg.transfer_group_id;
      if (!gid) continue;
      const list = counterpartByGroup.get(gid) ?? [];
      list.push(leg);
      counterpartByGroup.set(gid, list);
    }
  }

  const history = historyLines.flatMap((line) => {
    const boletoId = boletoIdByLine.get(line.id as string);
    const boleto = boletoId ? boletoById.get(boletoId) : undefined;
    if (!boleto) return [];
    const group = boleto.transfer_group_id
      ? counterpartByGroup.get(boleto.transfer_group_id)
      : undefined;
    const counterpart =
      group?.find((leg) => leg.id !== boleto.id) ?? null;
    return [
      {
        bankDescription: (line.description as string) ?? "",
        boleto,
        counterpart,
      },
    ];
  });

  return pickLaunchMemoryFromHistory(params.bankDescription, history, {
    entryKind: params.preferEntryKind,
    flowType: params.preferFlowType,
  });
}

export async function fetchReconciledBoletoIds(
  companyId: string,
  boletoIds: string[],
): Promise<Set<string>> {
  if (boletoIds.length === 0) return new Set();
  const wanted = new Set(boletoIds);
  const rows = await fetchAllInRange(
    supabase
      .from("bank_reconciliations")
      .select("boleto_id")
      .eq("company_id", companyId)
      .order("id", { ascending: true }),
  );
  return new Set(
    rows
      .map((r) => r.boleto_id as string)
      .filter((id) => wanted.has(id)),
  );
}

import { undoPayBoleto } from "@/lib/boletoPaymentApi";
import {
  buildDedupeKey,
  dedupeParsedTransactions,
  filterNewParsedTransactions,
} from "@/lib/bankReconciliation/dedupe";
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
import {
  isIgnoredReconLine,
  isPendingReconLine,
  isReconciledReconLine,
} from "@/lib/bankReconciliation/reconLineStatus";

export { isIgnoredReconLine, isPendingReconLine, isReconciledReconLine };

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

export type StatementImportResult = {
  importRow: BankStatementImport | null;
  lines: BankStatementLine[];
  insertedCount: number;
  skippedCount: number;
  ofxLedgerApplied: boolean;
  ofxLedgerAmount: number | null;
};

async function fetchExistingDedupeKeys(
  companyBankAccountId: string,
): Promise<Set<string>> {
  const rows = await fetchAllInRange<{ dedupe_key: string }>(
    supabase
      .from("bank_statement_lines")
      .select("dedupe_key")
      .eq("company_bank_account_id", companyBankAccountId)
      .order("id", { ascending: true }),
  );
  return new Set(rows.map((r) => r.dedupe_key));
}

export async function uploadAndImportStatement(params: {
  companyId: string;
  companyBankAccountId: string;
  file: File;
  userId: string | null;
  csvMapping?: BankCsvColumnMapping | null;
}): Promise<StatementImportResult> {
  const { companyId, companyBankAccountId, file, userId, csvMapping } = params;
  const format = detectFormat(file.name);
  const content = await file.text();
  const parsed = dedupeParsedTransactions(
    parseStatementFile(content, format, csvMapping),
    companyBankAccountId,
  );
  const ofxLedger =
    format === "ofx" ? parseOfxLedgerBalance(content) : null;
  const existingKeys = await fetchExistingDedupeKeys(companyBankAccountId);
  const { fresh, skippedCount } = filterNewParsedTransactions(
    parsed,
    companyBankAccountId,
    existingKeys,
  );

  const applyLedger = async (): Promise<{
    ofxLedgerApplied: boolean;
    ofxLedgerAmount: number | null;
  }> => {
    if (!ofxLedger) {
      return { ofxLedgerApplied: false, ofxLedgerAmount: null };
    }
    const ledgerAsOf = ofxLedger.asOfYmd ?? fresh[0]?.postedAt ?? parsed[0]?.postedAt ?? null;
    const ofxLedgerApplied = await applyOfxLedgerToAccount({
      companyBankAccountId,
      amount: ofxLedger.amount,
      asOfYmd: ledgerAsOf,
    });
    return { ofxLedgerApplied, ofxLedgerAmount: ofxLedger.amount };
  };

  if (fresh.length === 0) {
    const ledger = await applyLedger();
    return {
      importRow: null,
      lines: [],
      insertedCount: 0,
      skippedCount,
      ...ledger,
    };
  }

  const stamp = Date.now();
  const safeName = file.name.replace(/[^\w.-]+/g, "_");
  const storagePath = `${companyId}/${companyBankAccountId}/${stamp}_${safeName}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      upsert: false,
      contentType: file.type || "application/octet-stream",
    });
  if (upErr) throw upErr;

  const dates = fresh.map((p) => p.postedAt).sort();
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
      row_count: fresh.length,
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

  const lineRows = fresh.map((tx) => ({
    import_id: importRow.id,
    company_id: companyId,
    company_bank_account_id: companyBankAccountId,
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
  if (lineErr) {
    await supabase.from("bank_statement_imports").delete().eq("id", importRow.id);
    throw lineErr;
  }

  return {
    importRow: importRow as BankStatementImport,
    lines: (lines ?? []) as BankStatementLine[],
    insertedCount: (lines ?? []).length,
    skippedCount,
    ofxLedgerApplied,
    ofxLedgerAmount: ofxLedger?.amount ?? null,
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

/** Linhas da conta em todos os imports (pendentes, conciliadas e ignoradas). */
export async function fetchAccountStatementLines(
  companyId: string,
  companyBankAccountId: string,
): Promise<BankStatementLine[]> {
  return (await fetchAllInRange(
    supabase
      .from("bank_statement_lines")
      .select("*")
      .eq("company_id", companyId)
      .eq("company_bank_account_id", companyBankAccountId)
      .in("status", ["unmatched", "matched", "created_payable", "ignored"])
      .order("posted_at", { ascending: true })
      .order("id", { ascending: true }),
  )) as BankStatementLine[];
}

export async function fetchBoletosByIds(
  companyId: string,
  boletoIds: string[],
): Promise<Boleto[]> {
  if (boletoIds.length === 0) return [];
  const wanted = [...new Set(boletoIds)];
  const rows = await fetchAllInRange(
    supabase
      .from("boletos")
      .select("*, supplier:suppliers(id, name)")
      .eq("company_id", companyId)
      .in("id", wanted)
      .order("id", { ascending: true }),
  );
  return rows as Boleto[];
}

export async function fetchReconciliationsForLines(
  companyId: string,
  statementLineIds: string[],
): Promise<Map<string, { boletoId: string; matchKind: BankMatchKind }>> {
  const out = new Map<string, { boletoId: string; matchKind: BankMatchKind }>();
  if (statementLineIds.length === 0) return out;
  const rows = await fetchAllInRange<{
    statement_line_id: string;
    boleto_id: string;
    match_kind: BankMatchKind;
  }>(
    supabase
      .from("bank_reconciliations")
      .select("statement_line_id, boleto_id, match_kind")
      .eq("company_id", companyId)
      .in("statement_line_id", statementLineIds)
      .order("id", { ascending: true }),
  );
  for (const row of rows) {
    out.set(row.statement_line_id, {
      boletoId: row.boleto_id,
      matchKind: row.match_kind,
    });
  }
  return out;
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

  const { data: lineRow, error: lineFetchErr } = await supabase
    .from("bank_statement_lines")
    .select("id, status")
    .eq("id", statementLineId)
    .eq("company_id", companyId)
    .single();
  if (lineFetchErr) throw lineFetchErr;
  if (!lineRow || lineRow.status !== "unmatched") {
    throw new Error("Este movimento já foi conciliado ou lançado.");
  }

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

  const { data: lineRow, error: lineFetchErr } = await supabase
    .from("bank_statement_lines")
    .select("id, status")
    .eq("id", statementLineId)
    .eq("company_id", companyId)
    .single();
  if (lineFetchErr) throw lineFetchErr;
  if (!lineRow || lineRow.status !== "unmatched") {
    throw new Error("Este movimento já foi conciliado ou lançado.");
  }

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

export async function ignoreStatementLine(params: {
  companyId: string;
  statementLineId: string;
}): Promise<void> {
  const { data: line, error: fetchErr } = await supabase
    .from("bank_statement_lines")
    .select("id, status")
    .eq("id", params.statementLineId)
    .eq("company_id", params.companyId)
    .single();
  if (fetchErr) throw fetchErr;
  if (!line || line.status !== "unmatched") {
    throw new Error("Só é possível ignorar um movimento ainda não conciliado.");
  }

  const { error } = await supabase
    .from("bank_statement_lines")
    .update({ status: "ignored" })
    .eq("id", params.statementLineId)
    .eq("company_id", params.companyId)
    .eq("status", "unmatched");
  if (error) throw error;
}

export async function restoreIgnoredStatementLine(params: {
  companyId: string;
  statementLineId: string;
}): Promise<void> {
  const { data: line, error: fetchErr } = await supabase
    .from("bank_statement_lines")
    .select("id, status")
    .eq("id", params.statementLineId)
    .eq("company_id", params.companyId)
    .single();
  if (fetchErr) throw fetchErr;
  if (!line || line.status !== "ignored") {
    throw new Error("Só é possível restaurar um movimento ignorado.");
  }

  const { error } = await supabase
    .from("bank_statement_lines")
    .update({ status: "unmatched" })
    .eq("id", params.statementLineId)
    .eq("company_id", params.companyId)
    .eq("status", "ignored");
  if (error) throw error;
}

async function unlinkLineReconciliation(params: {
  companyId: string;
  statementLineId: string;
}): Promise<void> {
  const { error: reconErr } = await supabase
    .from("bank_reconciliations")
    .delete()
    .eq("company_id", params.companyId)
    .eq("statement_line_id", params.statementLineId);
  if (reconErr) throw reconErr;

  const { error: lineErr } = await supabase
    .from("bank_statement_lines")
    .update({ status: "unmatched" })
    .eq("id", params.statementLineId)
    .eq("company_id", params.companyId);
  if (lineErr) throw lineErr;
}

async function loadTransferGroup(
  companyId: string,
  boleto: Boleto,
): Promise<Boleto[]> {
  if (boleto.entry_kind !== "transfer" || !boleto.transfer_group_id) {
    return [boleto];
  }
  const { data, error } = await supabase
    .from("boletos")
    .select("*")
    .eq("company_id", companyId)
    .eq("transfer_group_id", boleto.transfer_group_id)
    .eq("entry_kind", "transfer");
  if (error) throw error;
  const rows = (data ?? []) as Boleto[];
  return rows.length > 0 ? rows : [boleto];
}

async function reopenReceivableGroup(
  companyId: string,
  boletos: Boleto[],
): Promise<void> {
  const updatedAt = new Date().toISOString();
  for (const row of boletos) {
    if (row.status !== "paid") continue;
    const keepBank = row.entry_kind === "transfer";
    const { error } = await supabase
      .from("boletos")
      .update({
        status: "pending",
        paid_at: null,
        competence_date: null,
        interest_amount: 0,
        discount_amount: 0,
        paid_amount: null,
        company_bank_account_id: keepBank ? row.company_bank_account_id : null,
        updated_at: updatedAt,
      })
      .eq("id", row.id)
      .eq("company_id", companyId);
    if (error) throw error;
  }
}

async function deleteCreatedLaunchBoletos(params: {
  companyId: string;
  boleto: Boleto;
}): Promise<void> {
  const group = await loadTransferGroup(params.companyId, params.boleto);
  const expenseIds = [
    ...new Set(group.map((b) => b.expense_id).filter((id): id is string => !!id)),
  ];
  const ids = group.map((b) => b.id);

  const { error: delErr } = await supabase
    .from("boletos")
    .delete()
    .eq("company_id", params.companyId)
    .in("id", ids);
  if (delErr) throw delErr;

  for (const expenseId of expenseIds) {
    const { count, error: countErr } = await supabase
      .from("boletos")
      .select("id", { count: "exact", head: true })
      .eq("company_id", params.companyId)
      .eq("expense_id", expenseId);
    if (countErr) throw countErr;
    if ((count ?? 0) > 0) continue;

    const { data: expense, error: expFetchErr } = await supabase
      .from("expenses")
      .select("id, type, expense_source")
      .eq("id", expenseId)
      .eq("company_id", params.companyId)
      .maybeSingle();
    if (expFetchErr) throw expFetchErr;
    if (
      !expense ||
      expense.type !== "recibo" ||
      expense.expense_source !== "manual"
    ) {
      continue;
    }
    const { error: expDelErr } = await supabase
      .from("expenses")
      .delete()
      .eq("id", expenseId)
      .eq("company_id", params.companyId);
    if (expDelErr) throw expDelErr;
  }
}

export async function undoBankReconciliation(params: {
  companyId: string;
  statementLineId: string;
  deleteCreatedLaunch?: boolean;
}): Promise<void> {
  const { companyId, statementLineId, deleteCreatedLaunch = false } = params;

  const { data: line, error: lineErr } = await supabase
    .from("bank_statement_lines")
    .select("*")
    .eq("id", statementLineId)
    .eq("company_id", companyId)
    .single();
  if (lineErr) throw lineErr;
  if (!line || !isReconciledReconLine(line as BankStatementLine)) {
    throw new Error("Este movimento não está conciliado.");
  }

  const { data: recon, error: reconErr } = await supabase
    .from("bank_reconciliations")
    .select("boleto_id")
    .eq("company_id", companyId)
    .eq("statement_line_id", statementLineId)
    .maybeSingle();
  if (reconErr) throw reconErr;

  const boletoId = recon?.boleto_id as string | undefined;
  let boleto: Boleto | null = null;
  if (boletoId) {
    const { data, error } = await supabase
      .from("boletos")
      .select("*")
      .eq("id", boletoId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw error;
    boleto = (data as Boleto | null) ?? null;
  }

  const shouldDelete =
    deleteCreatedLaunch && line.status === "created_payable" && boleto;

  if (shouldDelete && boleto) {
    await unlinkLineReconciliation({ companyId, statementLineId });
    await deleteCreatedLaunchBoletos({ companyId, boleto });
    return;
  }

  if (boleto && isBoletoPayable(boleto) && boleto.status === "paid") {
    await undoPayBoleto({ boletoId: boleto.id, companyId });
    return;
  }

  if (boleto) {
    const group = await loadTransferGroup(companyId, boleto);
    await unlinkLineReconciliation({ companyId, statementLineId });
    await reopenReceivableGroup(companyId, group);
    return;
  }

  await unlinkLineReconciliation({ companyId, statementLineId });
}

import { buildDedupeKey, dedupeParsedTransactions } from "@/lib/bankReconciliation/dedupe";
import { parseCsv } from "@/lib/bankReconciliation/parseCsv";
import { parseOfx } from "@/lib/bankReconciliation/parseOfx";
import {
  competenceDateFromMonthInput,
  computePaidAmount,
  monthInputFromYmd,
} from "@/lib/boletoPayment";
import { supabase } from "@/lib/supabase";
import type {
  BankCsvColumnMapping,
  BankMatchKind,
  BankStatementImport,
  BankStatementLine,
  BankStatementSourceFormat,
  ParsedBankTransaction,
} from "@/types/bankReconciliation";
import type { Boleto } from "@/types/expense";

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

export async function uploadAndImportStatement(params: {
  companyId: string;
  companyBankAccountId: string;
  file: File;
  userId: string | null;
  csvMapping?: BankCsvColumnMapping | null;
}): Promise<{ importRow: BankStatementImport; lines: BankStatementLine[] }> {
  const { companyId, companyBankAccountId, file, userId, csvMapping } = params;
  const format = detectFormat(file.name);
  const content = await file.text();
  const parsed = dedupeParsedTransactions(
    parseStatementFile(content, format, csvMapping),
    companyBankAccountId,
  );

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
      created_by: userId,
    })
    .select("*")
    .single();
  if (impErr) throw impErr;

  if (parsed.length === 0) {
    return {
      importRow: importRow as BankStatementImport,
      lines: [],
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
    status: tx.direction === "credit" ? "ignored" : "unmatched",
  }));

  const { data: lines, error: lineErr } = await supabase
    .from("bank_statement_lines")
    .insert(lineRows)
    .select("*");
  if (lineErr) throw lineErr;

  return {
    importRow: importRow as BankStatementImport,
    lines: (lines ?? []) as BankStatementLine[],
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

export async function fetchPayableBoletosForRecon(
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
    .eq("flow_type", "payable")
    .or(
      `and(status.eq.pending,due_date.gte.${start},due_date.lte.${end}),and(status.eq.paid,paid_at.gte.${start},paid_at.lte.${end})`,
    );
  if (error) throw error;
  return (data ?? []) as Boleto[];
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
}): Promise<void> {
  const {
    companyId,
    statementLineId,
    boletoId,
    userId,
    companyBankAccountId,
    paymentDate,
  } = params;

  const { data: boleto, error: fetchErr } = await supabase
    .from("boletos")
    .select("*")
    .eq("id", boletoId)
    .eq("company_id", companyId)
    .single();
  if (fetchErr) throw fetchErr;

  const original = Number(boleto.amount) || 0;
  const competenceDate =
    competenceDateFromMonthInput(monthInputFromYmd(paymentDate)) ||
    `${paymentDate.slice(0, 7)}-01`;

  if (boleto.status !== "paid") {
    const { error: payErr } = await supabase
      .from("boletos")
      .update({
        status: "paid",
        paid_at: paymentDate.slice(0, 10),
        competence_date: competenceDate,
        company_bank_account_id: companyBankAccountId,
        interest_amount: 0,
        discount_amount: 0,
        paid_amount: original,
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

export async function fetchReconciledBoletoIds(
  companyId: string,
  boletoIds: string[],
): Promise<Set<string>> {
  if (boletoIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("bank_reconciliations")
    .select("boleto_id")
    .eq("company_id", companyId)
    .in("boleto_id", boletoIds);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.boleto_id as string));
}

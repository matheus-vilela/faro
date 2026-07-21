export type BankStatementSourceFormat = "csv" | "ofx";

export type BankStatementImportStatus = "processing" | "ready" | "failed";

export type BankStatementLineDirection = "debit" | "credit";

export type BankStatementLineStatus =
  | "unmatched"
  | "matched"
  | "ignored"
  | "created_payable";

export type BankMatchKind = "forte" | "probable" | "manual";

/** Kind de linha na UI de conciliação (antes/depois de confirmar). */
export type BankReconRowKind =
  | "forte"
  | "provavel"
  | "sobanco"
  | "sofaro";

export interface BankStatementImport {
  id: string;
  company_id: string;
  company_bank_account_id: string;
  source_format: BankStatementSourceFormat;
  file_name: string | null;
  storage_path: string | null;
  period_start: string | null;
  period_end: string | null;
  status: BankStatementImportStatus;
  row_count: number;
  error_message: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BankStatementLine {
  id: string;
  import_id: string;
  company_id: string;
  posted_at: string;
  amount: number;
  direction: BankStatementLineDirection;
  description: string;
  fitid: string | null;
  dedupe_key: string;
  raw_json: Record<string, unknown> | null;
  status: BankStatementLineStatus;
  created_at: string;
  updated_at: string;
}

export interface BankReconciliation {
  id: string;
  company_id: string;
  statement_line_id: string;
  boleto_id: string;
  match_kind: BankMatchKind;
  confidence: number | null;
  amount_diff: number;
  reconciled_at: string;
  reconciled_by: string | null;
  created_at: string;
}

/** Linha parseada antes de persistir. */
export interface ParsedBankTransaction {
  postedAt: string;
  amount: number;
  direction: BankStatementLineDirection;
  description: string;
  fitid?: string | null;
  checkNum?: string | null;
  raw?: Record<string, unknown>;
}

export interface BankCsvColumnMapping {
  date: string;
  description: string;
  amount: string;
  balance?: string | null;
  /** Se ausente, sinal do valor define direção (negativo = débito). */
  direction?: string | null;
}

export const BTG_CSV_PRESET: BankCsvColumnMapping = {
  date: "Data",
  description: "Descricao",
  amount: "Valor",
  balance: "Saldo",
};

export type CompanyAlertKind =
  | "low_stock"
  | "expense_no_boleto"
  | "recebimento_falta";

export type CompanyAlertSeverity = "info" | "warning" | "danger";

export type CompanyAlertStatus = "open" | "dismissed";

export interface CompanyAlertRow {
  id: string;
  company_id: string;
  kind: CompanyAlertKind;
  severity: CompanyAlertSeverity;
  dedupe_key: string;
  title: string;
  message: string | null;
  link_path: string | null;
  payload: Record<string, unknown>;
  status: CompanyAlertStatus;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExpectedCompanyAlert {
  dedupe_key: string;
  kind: CompanyAlertKind;
  severity: CompanyAlertSeverity;
  title: string;
  message: string | null;
  link_path: string | null;
  payload: Record<string, unknown>;
}

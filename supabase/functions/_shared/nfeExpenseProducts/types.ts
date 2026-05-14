/** Versão por defeito do motor de catálogo XML (idempotência / ledger). */
export const NFE_CATALOG_MOTOR_VERSION = "nfe_catalog_v1";

export type NfeExpenseProductsInput = {
  company_id: string;
  expense_id: string;
  import_job_file_id?: string;
  xml_hash?: string;
  motor_version: string;
  mode: "apply" | "preview";
  /**
   * Quando true (só `apply`): não volta a correr match nem `update` em `expense_items`;
   * usa `import_score_reasons_json.xml_catalog_motor.batch_finalize` gravado no insert do batch.
   */
  finalize_after_batch_insert?: boolean;
};

export type NfeCatalogLineResolution =
  | "AUTO_MATCH"
  | "NEW_PRODUCT_CREATED"
  | "PENDING_REVIEW"
  | "SKIPPED";

export type NfeExpenseProductsResultLine = {
  expense_item_id: string;
  raw_import_id?: string | null;
  xml_line_identity: string;
  resolution: NfeCatalogLineResolution;
  product_id: string | null;
  confidence: number | null;
  reasons_json: Record<string, unknown>;
};

export type FinancialReconciliationOutcome = {
  document_total: number | null;
  sum_lines: number;
  gaps: {
    frete?: number;
    discount?: number;
    other?: Record<string, number>;
  };
  status: "OK" | "DIVERGENT" | "PARTIAL_UNKNOWN";
  expense_update?: {
    divergence_reason?: string;
    financial_reconciliation_json?: Record<string, unknown>;
  };
};

export type NfeExpenseProductsResult = {
  ok: boolean;
  expense_id: string;
  lines: NfeExpenseProductsResultLine[];
  financial: FinancialReconciliationOutcome;
  errors?: string[];
};

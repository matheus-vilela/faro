/**
 * Ponto único lógico para prompts de sistema (e user fixos) enviados a modelos na importação / despesas.
 * Submódulos por domínio; importe de `../aiPrompts/...` ou deste barrel.
 */

export {
  PRODUCT_MATCH_SYSTEM_BORDERLINE,
  PRODUCT_MATCH_SYSTEM_IMPORT_BATCH,
  PRODUCT_MATCH_SYSTEM_IMPORT_COLD_NEW,
} from "./productMatchImport.ts";
export { INVOICE_LINE_UNITS_SYSTEM } from "./invoiceLineUnitsNfe.ts";
export {
  EXPENSE_DOCUMENT_SYSTEM_PROMPT,
  EXPENSE_DOCUMENT_USER_PROMPT_IMAGE,
  EXPENSE_DOCUMENT_USER_PROMPT_PDF,
} from "./documentExpenseExtraction.ts";
export { ONBOARDING_PRODUCT_RECONCILIATION_SYSTEM } from "./onboardingCatalogReconciliation.ts";

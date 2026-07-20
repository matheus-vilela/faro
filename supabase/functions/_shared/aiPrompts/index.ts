/**
 * Ponto único lógico para prompts de sistema enviados a modelos (despesas / documentos).
 * Submódulos por domínio; importe de `../aiPrompts/...` ou deste barrel.
 */

export {
  EXPENSE_DOCUMENT_SYSTEM_PROMPT,
  EXPENSE_DOCUMENT_USER_PROMPT_IMAGE,
  EXPENSE_DOCUMENT_USER_PROMPT_PDF,
} from "./documentExpenseExtraction.ts";

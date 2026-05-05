/**
 * Opções de `resolveProductMatches` quando o documento veio de XML NF-e estruturado
 * (upload em Despesas / parse-expense-document). Alinha ao lote XML (`process-import-job-batch`).
 */
export function productMatchOptionsForNfeXmlUpload(): { importBatch: true } {
  return { importBatch: true };
}

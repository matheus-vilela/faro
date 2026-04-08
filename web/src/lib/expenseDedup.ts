import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Verifica se já existe outra despesa com o mesmo fornecedor (ID ou CNPJ/CPF)
 * e o mesmo número/série de documento. Usa a RPC `expense_find_duplicate_by_supplier_document`.
 */
export async function findExpenseDuplicateId(
  supabase: SupabaseClient,
  params: {
    companyId: string;
    supplierId: string | null;
    supplierDocumentDigits: string | null;
    invoiceNumber: string;
    invoiceSeries: string;
    excludeExpenseId?: string | null;
  },
): Promise<{ duplicateId: string | null; error: Error | null }> {
  const digits = (params.supplierDocumentDigits ?? "").replace(/\D/g, "");
  const supplierOk =
    !!params.supplierId || digits.length >= 11;
  const inv = params.invoiceNumber.trim();
  if (!inv || !supplierOk) {
    return { duplicateId: null, error: null };
  }

  const { data, error } = await supabase.rpc(
    "expense_find_duplicate_by_supplier_document",
    {
      p_company_id: params.companyId,
      p_supplier_id: params.supplierId,
      p_supplier_document: digits || "",
      p_invoice_number: inv,
      p_invoice_series: params.invoiceSeries ?? "",
      p_exclude_expense_id: params.excludeExpenseId ?? null,
    },
  );

  if (error) {
    return { duplicateId: null, error: new Error(error.message) };
  }
  return { duplicateId: (data as string | null) ?? null, error: null };
}

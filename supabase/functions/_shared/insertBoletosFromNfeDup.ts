/**
 * Insere um boleto a pagar por parcela discriminada na NF-e (cobrança / duplicata).
 */
import { extractDuplicatesFromNfeXml, type NfeDupRow } from "./extractDupFromNfeXml.ts";

/** Client Supabase já autenticado (sessão usuário ou service role). */
export async function insertBoletosFromNfeDupXml(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  companyId: string,
  expenseId: string,
  xmlText: string,
  invoiceRef: string,
): Promise<{ inserted: number; rows: NfeDupRow[] }> {
  const dups = extractDuplicatesFromNfeXml(xmlText);
  if (!dups.length) return { inserted: 0, rows: [] };

  let inserted = 0;
  for (const d of dups) {
    const label = d.nDup
      ? `NF-e · parcela ${d.nDup} (${invoiceRef})`
      : `NF-e · parcela (${invoiceRef})`;
    const { error } = await supabase.from("boletos").insert({
      company_id: companyId,
      expense_id: expenseId,
      description: label.slice(0, 512),
      due_date: d.dueDateYmd,
      amount: Math.round(d.amount * 100) / 100,
      flow_type: "payable",
      payment_type: "boleto",
      status: "pending",
    });
    if (error) {
      console.warn("[insertBoletosFromNfeDup]", error.message);
      continue;
    }
    inserted += 1;
  }
  return { inserted, rows: dups };
}

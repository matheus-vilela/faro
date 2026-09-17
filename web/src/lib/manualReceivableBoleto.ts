import type { Boleto } from "@/types/expense";
import { isBoletoTransfer } from "@/types/expense";

/** Título a receber cadastrado na tela financeira (não vem de venda nem de transferência). */
export function isManualReceivableBoleto(
  b: Pick<Boleto, "flow_type" | "revenue_entry_id" | "entry_kind">,
): boolean {
  if (b.flow_type !== "receivable") return false;
  if (b.revenue_entry_id) return false;
  if (isBoletoTransfer(b)) return false;
  return true;
}

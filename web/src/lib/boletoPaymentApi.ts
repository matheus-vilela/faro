import { supabase } from "@/lib/supabase";
import type { Boleto } from "@/types/expense";

export type SplitPayBoletoParams = {
  boletoId: string;
  companyId: string;
  payAmount: number;
  paidAt: string;
  competenceDate: string;
  bankAccountId: string;
  interestAmount: number;
  discountAmount: number;
  remainderDueDate: string;
};

export type SplitPayBoletoResult = {
  paid: Boleto;
  remainder: Boleto;
};

function asBoleto(value: unknown, label: string): Boleto {
  if (!value || typeof value !== "object") {
    throw new Error(`${label} não retornado.`);
  }
  return value as Boleto;
}

export async function splitPayBoleto(
  params: SplitPayBoletoParams,
): Promise<SplitPayBoletoResult> {
  const { data, error } = await supabase.rpc("split_pay_boleto", {
    p_boleto_id: params.boletoId,
    p_company_id: params.companyId,
    p_pay_amount: params.payAmount,
    p_paid_at: params.paidAt,
    p_competence_date: params.competenceDate,
    p_bank_account_id: params.bankAccountId,
    p_interest_amount: params.interestAmount,
    p_discount_amount: params.discountAmount,
    p_remainder_due_date: params.remainderDueDate,
  });
  if (error) {
    throw new Error(error.message ?? "Não foi possível registrar o pagamento parcial.");
  }
  const payload = data as { paid?: unknown; remainder?: unknown } | null;
  return {
    paid: asBoleto(payload?.paid, "Pagamento"),
    remainder: asBoleto(payload?.remainder, "Saldo"),
  };
}

export async function undoPayBoleto(params: {
  boletoId: string;
  companyId: string;
}): Promise<Boleto> {
  const { data, error } = await supabase.rpc("undo_pay_boleto", {
    p_boleto_id: params.boletoId,
    p_company_id: params.companyId,
  });
  if (error) {
    throw new Error(error.message ?? "Não foi possível desfazer o pagamento.");
  }
  return asBoleto(data, "Conta");
}

export async function fetchSplitRemainderBoletos(params: {
  companyId: string;
  parentBoletoId: string;
}): Promise<Pick<Boleto, "id" | "amount" | "due_date" | "status">[]> {
  const { data, error } = await supabase
    .from("boletos")
    .select("id, amount, due_date, status")
    .eq("company_id", params.companyId)
    .eq("split_from_boleto_id", params.parentBoletoId);
  if (error) {
    console.error(error);
    return [];
  }
  return (data ?? []) as Pick<Boleto, "id" | "amount" | "due_date" | "status">[];
}

import {
  mergeFluxoBoletos,
  normalizeSuppressed,
  parseExpenseSeriesMaster,
} from "@/lib/expenseSeriesProjection";
import { supabase } from "@/lib/supabase";
import type {
  ExpenseSeriesMaster,
  FluxoBoletoRow,
  ScheduledAdjustment,
} from "@/types/expenseSeries";
import type { Boleto, PaymentType } from "@/types/expense";

export async function fetchSeriesMastersWithAnchorBoletos(
  companyId: string,
): Promise<ExpenseSeriesMaster[]> {
  const { data: masters, error } = await supabase
    .from("expenses")
    .select(
      "id, company_id, series_type, recurrence_frequency, installment_count, recurrence_status, series_anchor_due_date, display_name, supplier_name, scheduled_adjustments, suppressed_occurrences",
    )
    .eq("company_id", companyId)
    .is("parent_expense_id", null)
    .in("series_type", ["recurring", "installment"]);

  if (error) throw error;
  const list = masters ?? [];
  if (!list.length) return [];

  const ids = list.map((m) => m.id);
  const { data: boletos, error: bErr } = await supabase
    .from("boletos")
    .select("*")
    .eq("company_id", companyId)
    .eq("flow_type", "payable")
    .in("expense_id", ids)
    .order("due_date", { ascending: true });

  if (bErr) throw bErr;

  const materializedByMaster = await fetchMaterializedMonthsByMaster(ids);

  const boletoByExpense = new Map<string, Boleto>();
  for (const b of (boletos ?? []) as Boleto[]) {
    if (b.expense_id && !boletoByExpense.has(b.expense_id)) {
      boletoByExpense.set(b.expense_id, b);
    }
  }

  return list
    .map((m) => {
      const anchor = boletoByExpense.get(m.id);
      if (!anchor) return null;
      const extra = materializedByMaster.get(m.id) ?? [];
      const suppressed = [
        ...new Set([
          ...normalizeSuppressed(m.suppressed_occurrences),
          ...extra,
        ]),
      ];
      return parseExpenseSeriesMaster({
        ...m,
        suppressed_occurrences: suppressed,
        anchor_boleto: anchor,
      });
    })
    .filter((x): x is ExpenseSeriesMaster => x != null);
}

async function fetchMaterializedMonthsByMaster(
  masterIds: string[],
): Promise<Map<string, string[]>> {
  if (!masterIds.length) return new Map();
  const { data, error } = await supabase
    .from("expenses")
    .select("parent_expense_id, occurrence_month, reference_date")
    .in("parent_expense_id", masterIds);
  if (error) throw error;
  const map = new Map<string, string[]>();
  for (const row of data ?? []) {
    const parent = row.parent_expense_id as string | null;
    if (!parent) continue;
    const mk =
      (row.occurrence_month as string | null)?.slice(0, 7) ??
      (row.reference_date as string | null)?.slice(0, 7);
    if (!mk || !/^\d{4}-\d{2}$/.test(mk)) continue;
    const list = map.get(parent) ?? [];
    if (!list.includes(mk)) list.push(mk);
    map.set(parent, list);
  }
  return map;
}

/** Converte vencimento do formulário em ajuste (dia do mês, não data fixa repetida). */
export function scheduledAdjustmentFromForm(
  effectiveFromMonthKey: string,
  amount: number,
  dueDateYmd: string,
): ScheduledAdjustment {
  const day = Math.min(
    28,
    Math.max(1, parseInt(dueDateYmd.slice(8, 10), 10) || 1),
  );
  return {
    effective_from: effectiveFromMonthKey,
    amount,
    due_day: day,
  };
}

async function syncAnchorBoletoIfAdjustmentMonth(
  masterExpenseId: string,
  anchorBoleto: Boleto,
  amount: number,
  dueDateYmd: string,
  monthKey: string,
): Promise<void> {
  const anchorMonth = anchorBoleto.due_date.slice(0, 7);
  if (monthKey !== anchorMonth) return;
  await supabase
    .from("expenses")
    .update({
      reference_date: dueDateYmd,
      document_total: amount,
      series_anchor_due_date: dueDateYmd,
    })
    .eq("id", masterExpenseId);
  await supabase
    .from("boletos")
    .update({
      due_date: dueDateYmd,
      amount,
    })
    .eq("id", anchorBoleto.id);
}

export async function fetchMergedPayableBoletosInRange(
  companyId: string,
  rangeStartYmd: string,
  rangeEndYmd: string,
): Promise<FluxoBoletoRow[]> {
  const [masters, realRes] = await Promise.all([
    fetchSeriesMastersWithAnchorBoletos(companyId),
    supabase
      .from("boletos")
      .select("*")
      .eq("company_id", companyId)
      .eq("flow_type", "payable")
      .gte("due_date", rangeStartYmd)
      .lte("due_date", rangeEndYmd)
      .order("due_date", { ascending: true }),
  ]);

  if (realRes.error) throw realRes.error;
  const real = (realRes.data ?? []) as Boleto[];
  return mergeFluxoBoletos(real, masters, rangeStartYmd, rangeEndYmd);
}

export async function suppressProjectedMonth(
  masterExpenseId: string,
  monthKey: string,
): Promise<void> {
  const { data: master, error } = await supabase
    .from("expenses")
    .select("suppressed_occurrences")
    .eq("id", masterExpenseId)
    .single();
  if (error) throw error;
  const current = Array.isArray(master?.suppressed_occurrences)
    ? (master.suppressed_occurrences as string[])
    : [];
  if (current.includes(monthKey)) return;
  const { error: upErr } = await supabase
    .from("expenses")
    .update({
      suppressed_occurrences: [...current, monthKey],
    })
    .eq("id", masterExpenseId);
  if (upErr) throw upErr;
}

export async function upsertScheduledAdjustment(
  masterExpenseId: string,
  adjustment: ScheduledAdjustment,
  options?: {
    replaceUntilNext?: boolean;
    anchorBoleto?: Boleto;
    syncAnchorDueDateYmd?: string;
  },
): Promise<void> {
  const { data: master, error } = await supabase
    .from("expenses")
    .select("scheduled_adjustments")
    .eq("id", masterExpenseId)
    .single();
  if (error) throw error;

  let list = Array.isArray(master?.scheduled_adjustments)
    ? [...(master.scheduled_adjustments as ScheduledAdjustment[])]
    : [];

  if (options?.replaceUntilNext) {
    const nextIdx = list.findIndex(
      (a) => a.effective_from > adjustment.effective_from,
    );
    if (nextIdx >= 0) {
      list = list.slice(0, nextIdx);
    }
    list = list.filter((a) => a.effective_from < adjustment.effective_from);
  } else {
    list = list.filter((a) => a.effective_from !== adjustment.effective_from);
  }

  list.push(adjustment);
  list.sort((a, b) => a.effective_from.localeCompare(b.effective_from));

  const { error: upErr } = await supabase
    .from("expenses")
    .update({ scheduled_adjustments: list })
    .eq("id", masterExpenseId);
  if (upErr) throw upErr;

  if (
    options?.anchorBoleto &&
    options.syncAnchorDueDateYmd &&
    adjustment.amount != null
  ) {
    await syncAnchorBoletoIfAdjustmentMonth(
      masterExpenseId,
      options.anchorBoleto,
      adjustment.amount,
      options.syncAnchorDueDateYmd,
      adjustment.effective_from,
    );
  }
}

export async function materializeSeriesMonth(input: {
  companyId: string;
  masterExpenseId: string;
  occurrenceMonth: string;
  amount: number;
  dueDate: string;
  description: string;
  paymentType: PaymentType;
  anchorBoleto: Boleto;
  masterDisplayName: string | null;
  supplierName: string | null;
}): Promise<{ expenseId: string; boletoId: string }> {
  const monthKey = input.occurrenceMonth.slice(0, 7);
  const occurrenceMonth = `${monthKey}-01`;
  const anchorMonth = input.anchorBoleto.due_date.slice(0, 7);

  if (monthKey === anchorMonth) {
    await supabase
      .from("expenses")
      .update({
        display_name: input.description,
        reference_date: input.dueDate,
        document_total: input.amount,
        series_anchor_due_date: input.dueDate,
      })
      .eq("id", input.masterExpenseId);
    await supabase
      .from("boletos")
      .update({
        description: input.description,
        due_date: input.dueDate,
        amount: input.amount,
        payment_type: input.paymentType,
      })
      .eq("id", input.anchorBoleto.id);
    return {
      expenseId: input.masterExpenseId,
      boletoId: input.anchorBoleto.id,
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: childExp, error: expErr } = await supabase
    .from("expenses")
    .insert({
      company_id: input.companyId,
      created_by: user?.id ?? null,
      type: "recibo",
      parent_expense_id: input.masterExpenseId,
      occurrence_month: occurrenceMonth,
      series_type: "single",
      display_name: input.description,
      supplier_name: input.supplierName,
      status: "approved",
      expense_source: "manual",
      reference_date: input.dueDate,
      document_total: input.amount,
      series_anchor_due_date: input.dueDate,
    })
    .select("id")
    .single();

  if (expErr) throw expErr;

  await supabase.from("expense_items").insert({
    company_id: input.companyId,
    expense_id: childExp.id,
    product_name: input.description,
    quantity: 1,
    unit_value: input.amount,
    stock_added: false,
  });

  const b = input.anchorBoleto;
  const { data: childBol, error: bolErr } = await supabase
    .from("boletos")
    .insert({
      company_id: input.companyId,
      expense_id: childExp.id,
      flow_type: "payable",
      description: input.description,
      due_date: input.dueDate,
      amount: input.amount,
      company_category_id: b.company_category_id,
      category: b.category,
      payment_type: input.paymentType,
      barcode: b.barcode,
      provider: b.provider,
      pix_key_type: b.pix_key_type,
      pix_key: b.pix_key,
      bank_name: b.bank_name,
      bank_code: b.bank_code,
      agency: b.agency,
      account: b.account,
      account_type: b.account_type,
      status: "pending",
    })
    .select("id")
    .single();

  if (bolErr) throw bolErr;

  await suppressProjectedMonth(input.masterExpenseId, monthKey);

  return { expenseId: childExp.id, boletoId: childBol.id };
}

export async function deleteExpenseSeriesMaster(
  masterExpenseId: string,
): Promise<void> {
  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", masterExpenseId);
  if (error) throw error;
}

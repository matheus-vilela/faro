import { boletoVisibleInFluxo } from "@/lib/boletoFluxo";
import {
  boletoCounterpartyLabel,
  formatBoletoFluxoDescription,
} from "@/lib/boletoFluxoDescription";
import { fetchMergedPayableBoletosInRange } from "@/lib/expenseSeriesApi";
import { isProjectedBoleto } from "@/lib/expenseSeriesProjection";
import { supabase } from "@/lib/supabase";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import type { Boleto } from "@/types/expense";
import {
  getCashFlowFetchRange,
  toRawCashFlowItem,
} from "./computeCashFlowProjection";
import type { HorizonWeeks, RawCashFlowItem } from "./types";

type PendingReceivableRow = Pick<
  Boleto,
  "id" | "description" | "due_date" | "amount" | "status" | "exclude_from_fluxo"
>;

type PaidBoletoRow = Pick<
  Boleto,
  | "id"
  | "description"
  | "due_date"
  | "amount"
  | "paid_amount"
  | "paid_at"
  | "status"
  | "exclude_from_fluxo"
  | "flow_type"
  | "provider"
> & {
  supplier?: { id?: string; name?: string | null } | null;
};

function isPendingCashFlowBoleto(
  b: Pick<Boleto, "status"> & { is_projected?: boolean },
): boolean {
  if (isProjectedBoleto(b)) return true;
  return b.status === "pending";
}

function settledAmount(b: Pick<Boleto, "amount" | "paid_amount">): number {
  return Number(b.paid_amount ?? b.amount) || 0;
}

function settledDateYmd(b: Pick<Boleto, "paid_at" | "due_date">): string {
  return String(b.paid_at ?? b.due_date).slice(0, 10);
}

function outflowLabels(b: {
  description?: string | null;
  provider?: string | null;
  supplier?: { name?: string | null } | null;
}): { description?: string; counterpartyLabel?: string } {
  const description =
    formatBoletoFluxoDescription({ description: b.description ?? "" }) ||
    undefined;
  const counterpartyLabel =
    boletoCounterpartyLabel({
      provider: b.provider ?? null,
      supplier: b.supplier,
    }) ?? undefined;
  return { description, counterpartyLabel };
}

async function fetchPaidBoletosInRange(
  companyId: string,
  flowType: "payable" | "receivable",
  startYmd: string,
  endYmd: string,
): Promise<PaidBoletoRow[]> {
  // Select fixo; cast porque o tipado do embed many-to-one vem como array.
  const rows = await fetchAllInRange(
    supabase
      .from("boletos")
      .select(
        "id, description, due_date, amount, paid_amount, paid_at, status, exclude_from_fluxo, flow_type, provider, supplier:suppliers(id, name)",
      )
      .eq("company_id", companyId)
      .eq("flow_type", flowType)
      .eq("status", "paid")
      .eq("exclude_from_fluxo", false)
      .gte("paid_at", `${startYmd}T00:00:00`)
      .lte("paid_at", `${endYmd}T23:59:59.999`)
      .order("paid_at", { ascending: true }),
  );
  return rows as PaidBoletoRow[];
}

export async function fetchKnownCashFlowItems(input: {
  companyId: string;
  todayYmd: string;
  horizonWeeks: HorizonWeeks;
  includePayables: boolean;
  includeReceivables: boolean;
  weekStartsOn?: number;
}): Promise<RawCashFlowItem[]> {
  const { startYmd, endYmd } = getCashFlowFetchRange(
    input.todayYmd,
    input.horizonWeeks,
    input.weekStartsOn ?? 1,
  );

  const [payablesPending, payablesPaid, receivablesPending, receivablesPaid] =
    await Promise.all([
      input.includePayables
        ? fetchMergedPayableBoletosInRange(input.companyId, startYmd, endYmd)
        : Promise.resolve([]),
      input.includePayables
        ? fetchPaidBoletosInRange(input.companyId, "payable", startYmd, endYmd)
        : Promise.resolve([]),
      input.includeReceivables
        ? fetchAllInRange<PendingReceivableRow>(
            supabase
              .from("boletos")
              .select(
                "id, description, due_date, amount, status, exclude_from_fluxo",
              )
              .eq("company_id", input.companyId)
              .eq("flow_type", "receivable")
              .eq("status", "pending")
              .eq("exclude_from_fluxo", false)
              .gte("due_date", startYmd)
              .lte("due_date", endYmd)
              .order("due_date", { ascending: true }),
          )
        : Promise.resolve([]),
      input.includeReceivables
        ? fetchPaidBoletosInRange(
            input.companyId,
            "receivable",
            startYmd,
            endYmd,
          )
        : Promise.resolve([]),
    ]);

  const items: RawCashFlowItem[] = [];

  for (const b of payablesPending) {
    if (!isPendingCashFlowBoleto(b)) continue;
    if (!isProjectedBoleto(b) && !boletoVisibleInFluxo(b)) continue;

    const labels = outflowLabels(b);
    items.push(
      toRawCashFlowItem({
        id: String(b.id),
        direction: "outflow",
        amount: Number(b.amount) || 0,
        dueDateYmd: String(b.due_date).slice(0, 10),
        description: labels.description,
        counterpartyLabel: labels.counterpartyLabel,
        isProjected: isProjectedBoleto(b),
      }),
    );
  }

  for (const b of payablesPaid) {
    if (!boletoVisibleInFluxo(b)) continue;
    const labels = outflowLabels(b);
    items.push(
      toRawCashFlowItem({
        id: String(b.id),
        direction: "outflow",
        amount: settledAmount(b),
        dueDateYmd: settledDateYmd(b),
        description: labels.description,
        counterpartyLabel: labels.counterpartyLabel,
        isSettled: true,
      }),
    );
  }

  for (const b of receivablesPending) {
    if (!boletoVisibleInFluxo(b)) continue;

    items.push(
      toRawCashFlowItem({
        id: String(b.id),
        direction: "inflow",
        amount: Number(b.amount) || 0,
        dueDateYmd: String(b.due_date).slice(0, 10),
        description: formatBoletoFluxoDescription(b) || undefined,
      }),
    );
  }

  for (const b of receivablesPaid) {
    if (!boletoVisibleInFluxo(b)) continue;
    items.push(
      toRawCashFlowItem({
        id: String(b.id),
        direction: "inflow",
        amount: settledAmount(b),
        dueDateYmd: settledDateYmd(b),
        description: formatBoletoFluxoDescription(b) || undefined,
        isSettled: true,
      }),
    );
  }

  return items;
}

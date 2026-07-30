import { boletoVisibleInFluxo } from "@/lib/boletoFluxo";
import { fetchMergedPayableBoletosInRange } from "@/lib/expenseSeriesApi";
import { isProjectedBoleto } from "@/lib/expenseSeriesProjection";
import { supabase } from "@/lib/supabase";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import type { Boleto } from "@/types/expense";
import { toRawCashFlowItem } from "./computeCashFlowProjection";
import type { HorizonWeeks, RawCashFlowItem } from "./types";
import { getCashFlowFetchRange } from "./computeCashFlowProjection";

type ReceivableBoletoRow = Pick<
  Boleto,
  "id" | "description" | "due_date" | "amount" | "status" | "exclude_from_fluxo"
>;

function isPendingCashFlowBoleto(
  b: Pick<Boleto, "status"> & { is_projected?: boolean },
): boolean {
  if (isProjectedBoleto(b)) return true;
  return b.status === "pending";
}

export async function fetchKnownCashFlowItems(input: {
  companyId: string;
  todayYmd: string;
  horizonWeeks: HorizonWeeks;
  includePayables: boolean;
  includeReceivables: boolean;
}): Promise<RawCashFlowItem[]> {
  const { startYmd, endYmd } = getCashFlowFetchRange(
    input.todayYmd,
    input.horizonWeeks,
  );

  const [payables, receivables] = await Promise.all([
    input.includePayables
      ? fetchMergedPayableBoletosInRange(input.companyId, startYmd, endYmd)
      : Promise.resolve([]),
    input.includeReceivables
      ? fetchAllInRange<ReceivableBoletoRow>(
          supabase
            .from("boletos")
            .select("id, description, due_date, amount, status, exclude_from_fluxo")
            .eq("company_id", input.companyId)
            .eq("flow_type", "receivable")
            .eq("status", "pending")
            .eq("exclude_from_fluxo", false)
            .gte("due_date", startYmd)
            .lte("due_date", endYmd)
            .order("due_date", { ascending: true }),
        )
      : Promise.resolve([]),
  ]);

  const items: RawCashFlowItem[] = [];

  for (const b of payables) {
    if (!isPendingCashFlowBoleto(b)) continue;
    if (!isProjectedBoleto(b) && !boletoVisibleInFluxo(b)) continue;

    items.push(
      toRawCashFlowItem({
        id: String(b.id),
        direction: "outflow",
        amount: Number(b.amount) || 0,
        dueDateYmd: String(b.due_date).slice(0, 10),
        description: b.description ?? undefined,
        isProjected: isProjectedBoleto(b),
      }),
    );
  }

  for (const b of receivables) {
    if (!boletoVisibleInFluxo(b)) continue;

    items.push(
      toRawCashFlowItem({
        id: String(b.id),
        direction: "inflow",
        amount: Number(b.amount) || 0,
        dueDateYmd: String(b.due_date).slice(0, 10),
        description: b.description ?? undefined,
      }),
    );
  }

  return items;
}

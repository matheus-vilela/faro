import {
  boletoCounterpartyLabel,
  formatBoletoFluxoDescription,
} from "@/lib/boletoFluxoDescription";
import { localDateYmd } from "@/lib/boletoPayment";
import { fetchMergedPayableBoletosInRange } from "@/lib/expenseSeriesApi";
import { supabase } from "@/lib/supabase";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import type { Boleto } from "@/types/expense";
import type { FluxoBoletoRow } from "@/types/expenseSeries";
import type { ReportFilterState } from "./types";

export const BOLETO_SELECT =
  "id, company_id, expense_id, flow_type, entry_kind, description, emission_date, due_date, amount, company_category_id, payment_type, provider, status, exclude_from_fluxo, supplier_id, paid_at, competence_date, company_bank_account_id, interest_amount, discount_amount, paid_amount, created_at, updated_at, supplier:suppliers(id, name, document)";

export type BoletoReportRow = FluxoBoletoRow & {
  supplier?: { id?: string; name?: string | null; document?: string | null } | null;
};

export type BoletoLookups = {
  categoryById: Map<string, string>;
  bankById: Map<string, string>;
};

export async function fetchBoletoLookups(
  companyId: string,
): Promise<BoletoLookups> {
  const [catRes, bankRes] = await Promise.all([
    supabase
      .from("company_categories")
      .select("id, name")
      .eq("company_id", companyId),
    supabase
      .from("company_bank_accounts")
      .select("id, name")
      .eq("company_id", companyId),
  ]);
  if (catRes.error) throw catRes.error;
  if (bankRes.error) throw bankRes.error;
  return {
    categoryById: new Map(
      (catRes.data ?? []).map((c) => [c.id as string, String(c.name ?? "")]),
    ),
    bankById: new Map(
      (bankRes.data ?? []).map((b) => [b.id as string, String(b.name ?? "")]),
    ),
  };
}

export async function fetchBoletosForReport(input: {
  companyId: string;
  flowType: "payable" | "receivable";
  dateField: "due_date" | "paid_at";
  dateFrom: string;
  dateTo: string;
  status?: "pending" | "paid";
  includeProjectedPayables?: boolean;
}): Promise<BoletoReportRow[]> {
  const {
    companyId,
    flowType,
    dateField,
    dateFrom,
    dateTo,
    status,
    includeProjectedPayables,
  } = input;

  if (
    flowType === "payable" &&
    includeProjectedPayables &&
    dateField === "due_date"
  ) {
    const merged = await fetchMergedPayableBoletosInRange(
      companyId,
      dateFrom,
      dateTo,
    );
    return merged.filter((b) => {
      if (status && b.status !== status && !b.is_projected) return false;
      if (status === "pending" && b.is_projected) return true;
      if (status && !b.is_projected && b.status !== status) return false;
      return true;
    });
  }

  let q = supabase
    .from("boletos")
    .select(BOLETO_SELECT)
    .eq("company_id", companyId)
    .eq("flow_type", flowType)
    .eq("exclude_from_fluxo", false)
    .neq("entry_kind", "transfer");

  if (status) q = q.eq("status", status);

  if (dateField === "paid_at") {
    q = q
      .gte("paid_at", `${dateFrom}T00:00:00`)
      .lte("paid_at", `${dateTo}T23:59:59.999`)
      .order("paid_at", { ascending: true });
  } else {
    q = q
      .gte("due_date", dateFrom)
      .lte("due_date", dateTo)
      .order("due_date", { ascending: true });
  }

  const rows = (await fetchAllInRange(q as never)) as BoletoReportRow[];
  return rows;
}

export function applyBoletoClientFilters(
  rows: BoletoReportRow[],
  filters: Pick<
    ReportFilterState,
    | "openDueBucket"
    | "categoryId"
    | "supplierId"
    | "search"
    | "bankAccountId"
    | "situation"
  >,
  todayYmd = localDateYmd(),
): BoletoReportRow[] {
  const search = filters.search.trim().toLowerCase();
  return rows.filter((b) => {
    if (b.entry_kind === "transfer") return false;
    if (b.exclude_from_fluxo === true) return false;

    const due = String(b.due_date ?? "").slice(0, 10);
    const pending = b.status === "pending" || Boolean(b.is_projected);
    if (filters.openDueBucket === "overdue") {
      if (!pending || !due || due >= todayYmd) return false;
    } else if (filters.openDueBucket === "upcoming") {
      if (!pending || !due || due < todayYmd) return false;
    }

    if (filters.situation === "pending" && !pending) return false;
    if (filters.situation === "paid" && (pending || b.status !== "paid")) {
      return false;
    }

    if (
      filters.categoryId !== "all" &&
      b.company_category_id !== filters.categoryId
    ) {
      return false;
    }
    if (
      filters.supplierId !== "all" &&
      b.supplier_id !== filters.supplierId
    ) {
      return false;
    }
    if (
      filters.bankAccountId !== "all" &&
      b.company_bank_account_id !== filters.bankAccountId
    ) {
      return false;
    }
    if (search) {
      const hay = [
        formatBoletoFluxoDescription(b),
        boletoCounterpartyLabel(b) ?? "",
        b.supplier?.name ?? "",
        b.provider ?? "",
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

export function boletoSituationLabel(
  b: Pick<Boleto, "status" | "due_date"> & { is_projected?: boolean },
  todayYmd = localDateYmd(),
): string {
  const pending = b.status === "pending" || Boolean(b.is_projected);
  const due = String(b.due_date ?? "").slice(0, 10);
  if (pending && due && due < todayYmd) return "Vencido";
  if (pending) return "Em aberto";
  return "Pago";
}

export function boletoFlowLabel(
  flowType: string | null | undefined,
): string {
  return flowType === "receivable" ? "A receber" : "A pagar";
}

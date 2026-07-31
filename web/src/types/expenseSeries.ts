import type { Boleto, PaymentType } from "@/types/expense";

export type ExpenseSeriesType = "single" | "recurring" | "installment";

export type RecurrenceFrequency =
  | "weekly"
  | "biweekly"
  | "monthly"
  | "bimonthly"
  | "quarterly"
  | "semiannual"
  | "annual";

export type RecurrenceStatus = "active" | "inactive";

/** Ajuste com vigência a partir de um mês (inclusive). */
export type ScheduledAdjustment = {
  effective_from: string;
  amount?: number;
  /** Dia do vencimento (1–28) aplicado em cada mês da série. Preferir a `due_date`. */
  due_day?: number;
  /** Legado: usa-se só o dia do mês, não a data inteira repetida. */
  due_date?: string;
};

export type ExpenseSeriesMaster = {
  id: string;
  company_id: string;
  series_type: ExpenseSeriesType;
  recurrence_frequency: RecurrenceFrequency | null;
  installment_count: number | null;
  recurrence_status: RecurrenceStatus | null;
  series_anchor_due_date: string | null;
  display_name: string | null;
  supplier_name: string | null;
  scheduled_adjustments: ScheduledAdjustment[];
  suppressed_occurrences: string[];
  anchor_boleto: Boleto;
};

export type FluxoBoletoRow = Omit<Boleto, "supplier"> & {
  is_projected?: boolean;
  series_master_expense_id?: string | null;
  occurrence_month?: string | null;
  is_series_exception?: boolean;
  /** Embed opcional (fluxo / série); `document` vem do join com suppliers. */
  supplier?: {
    id?: string;
    name?: string | null;
    document?: string | null;
  } | null;
};

export type SeriesEditScope = "single_month" | "from_month" | "until_next_adjustment";

export type MaterializeSeriesMonthInput = {
  companyId: string;
  masterExpenseId: string;
  occurrenceMonth: string;
  amount: number;
  dueDate: string;
  description?: string;
  paymentType?: PaymentType;
};

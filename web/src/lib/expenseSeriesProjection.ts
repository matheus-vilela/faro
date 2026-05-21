import type {
  ExpenseSeriesMaster,
  FluxoBoletoRow,
  RecurrenceFrequency,
  ScheduledAdjustment,
} from "@/types/expenseSeries";
import type { Boleto } from "@/types/expense";

const PROJECTED_ID_PREFIX = "virtual:";

export function isProjectedBoleto(
  b: Pick<Boleto, "id"> & { is_projected?: boolean },
): boolean {
  return !!b.is_projected || String(b.id).startsWith(PROJECTED_ID_PREFIX);
}

export function monthKeyFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function monthKeyFromYmd(ymd: string): string {
  return ymd.slice(0, 7);
}

export function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

function parseMonthKey(key: string): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1, 12, 0, 0);
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function clampDayInMonth(year: number, month: number, day: number): number {
  const last = new Date(year, month, 0).getDate();
  return Math.min(Math.max(day, 1), last);
}

function addMonthsPreserveDay(anchor: Date, monthsToAdd: number): Date {
  const day = anchor.getDate();
  const target = new Date(
    anchor.getFullYear(),
    anchor.getMonth() + monthsToAdd,
    1,
    12,
    0,
    0,
  );
  const d = clampDayInMonth(
    target.getFullYear(),
    target.getMonth() + 1,
    day,
  );
  return new Date(
    target.getFullYear(),
    target.getMonth(),
    d,
    12,
    0,
    0,
  );
}

function addPeriod(
  anchor: Date,
  frequency: RecurrenceFrequency,
  index: number,
): Date {
  if (index <= 0) return new Date(anchor.getTime());
  switch (frequency) {
    case "weekly":
      return new Date(
        anchor.getFullYear(),
        anchor.getMonth(),
        anchor.getDate() + index * 7,
        12,
        0,
        0,
      );
    case "biweekly":
      return new Date(
        anchor.getFullYear(),
        anchor.getMonth(),
        anchor.getDate() + index * 14,
        12,
        0,
        0,
      );
    case "monthly":
      return addMonthsPreserveDay(anchor, index);
    case "bimonthly":
      return addMonthsPreserveDay(anchor, index * 2);
    case "quarterly":
      return addMonthsPreserveDay(anchor, index * 3);
    case "semiannual":
      return addMonthsPreserveDay(anchor, index * 6);
    case "annual":
      return addMonthsPreserveDay(anchor, index * 12);
    default:
      return addMonthsPreserveDay(anchor, index);
  }
}

function monthsBetweenInclusive(startKey: string, endKey: string): string[] {
  const out: string[] = [];
  let cur = parseMonthKey(startKey);
  const end = parseMonthKey(endKey);
  while (cur <= end) {
    out.push(monthKeyFromDate(cur));
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1, 12, 0, 0);
  }
  return out;
}

function normalizeAdjustments(raw: unknown): ScheduledAdjustment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const o = row as Record<string, unknown>;
      const effective_from = String(o.effective_from ?? "").slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(effective_from)) return null;
      const adj: ScheduledAdjustment = { effective_from };
      if (o.amount != null && Number.isFinite(Number(o.amount))) {
        adj.amount = Number(o.amount);
      }
      if (o.due_day != null && Number.isFinite(Number(o.due_day))) {
        const d = Math.min(28, Math.max(1, Math.round(Number(o.due_day))));
        adj.due_day = d;
      }
      if (typeof o.due_date === "string" && o.due_date.trim()) {
        adj.due_date = o.due_date.trim().slice(0, 10);
        if (adj.due_day == null) {
          adj.due_day = parseYmd(adj.due_date).getDate();
        }
      }
      return adj;
    })
    .filter((x): x is ScheduledAdjustment => x !== null)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
}

function normalizeSuppressed(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => {
      if (typeof x === "string") return x.slice(0, 7);
      if (x && typeof x === "object" && "month" in x) {
        return String((x as { month: string }).month).slice(0, 7);
      }
      return null;
    })
    .filter((x): x is string => !!x && /^\d{4}-\d{2}$/.test(x));
}

export function parseExpenseSeriesMaster(row: {
  id: string;
  company_id: string;
  series_type: string;
  recurrence_frequency?: string | null;
  installment_count?: number | null;
  recurrence_status?: string | null;
  series_anchor_due_date?: string | null;
  display_name?: string | null;
  supplier_name?: string | null;
  scheduled_adjustments?: unknown;
  suppressed_occurrences?: unknown;
  anchor_boleto: Boleto;
}): ExpenseSeriesMaster | null {
  if (row.series_type !== "recurring" && row.series_type !== "installment") {
    return null;
  }
  return {
    id: row.id,
    company_id: row.company_id,
    series_type: row.series_type as ExpenseSeriesMaster["series_type"],
    recurrence_frequency: (row.recurrence_frequency as RecurrenceFrequency) ?? null,
    installment_count: row.installment_count ?? null,
    recurrence_status: (row.recurrence_status as ExpenseSeriesMaster["recurrence_status"]) ?? null,
    series_anchor_due_date: row.series_anchor_due_date ?? null,
    display_name: row.display_name ?? null,
    supplier_name: row.supplier_name ?? null,
    scheduled_adjustments: normalizeAdjustments(row.scheduled_adjustments),
    suppressed_occurrences: normalizeSuppressed(row.suppressed_occurrences),
    anchor_boleto: row.anchor_boleto,
  };
}

function resolveOccurrenceParams(
  master: ExpenseSeriesMaster,
  occurrenceMonth: string,
  occurrenceIndex: number,
): { amount: number; dueDate: string } {
  const anchorYmd =
    master.series_anchor_due_date ??
    master.anchor_boleto.due_date.slice(0, 10);
  const anchor = parseYmd(anchorYmd);
  let amount = Number(master.anchor_boleto.amount);
  let dueDate =
    occurrenceIndex === 0
      ? anchorYmd
      : formatYmd(
          master.series_type === "recurring" && master.recurrence_frequency
            ? addPeriod(anchor, master.recurrence_frequency, occurrenceIndex)
            : addMonthsPreserveDay(anchor, occurrenceIndex),
        );

  const [occYear, occMonthNum] = occurrenceMonth.split("-").map(Number);

  for (const adj of master.scheduled_adjustments) {
    if (adj.effective_from <= occurrenceMonth) {
      if (adj.amount != null) amount = adj.amount;
      const day =
        adj.due_day ??
        (adj.due_date ? parseYmd(adj.due_date).getDate() : null);
      if (day != null) {
        const d = clampDayInMonth(occYear, occMonthNum, day);
        dueDate = formatYmd(new Date(occYear, occMonthNum - 1, d, 12, 0, 0));
      }
    }
  }

  return { amount, dueDate };
}

function isMonthInRange(monthKey: string, startYmd: string, endYmd: string): boolean {
  const d = parseMonthKey(monthKey);
  const start = parseYmd(startYmd);
  const end = parseYmd(endYmd);
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
  const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12, 0, 0);
  return monthEnd >= start && monthStart <= end;
}

function buildProjectedRow(
  master: ExpenseSeriesMaster,
  occurrenceIndex: number,
  occurrenceMonth: string,
  params: { amount: number; dueDate: string },
): FluxoBoletoRow {
  const b = master.anchor_boleto;
  const label =
    master.display_name?.trim() ||
    b.description?.trim() ||
    "Conta recorrente";
  const suffix =
    master.series_type === "installment" && master.installment_count
      ? ` · ${occurrenceIndex + 1}/${master.installment_count}`
      : "";
  return {
    ...b,
    id: `${PROJECTED_ID_PREFIX}${master.id}:${occurrenceMonth}`,
    expense_id: master.id,
    description: `${label}${suffix}`,
    due_date: params.dueDate,
    amount: params.amount,
    status: "pending",
    is_projected: true,
    series_master_expense_id: master.id,
    occurrence_month: `${occurrenceMonth}-01`,
    created_at: b.created_at,
    updated_at: b.updated_at,
  };
}

export function projectSeriesOccurrencesInRange(
  master: ExpenseSeriesMaster,
  rangeStartYmd: string,
  rangeEndYmd: string,
): FluxoBoletoRow[] {
  if (
    master.series_type === "recurring" &&
    master.recurrence_status === "inactive"
  ) {
    return [];
  }

  const anchorYmd =
    master.series_anchor_due_date ??
    master.anchor_boleto.due_date.slice(0, 10);
  const anchor = parseYmd(anchorYmd);
  const suppressed = new Set(master.suppressed_occurrences);
  const total =
    master.series_type === "installment"
      ? Math.max(1, master.installment_count ?? 1)
      : null;
  const maxIndex = total != null ? total - 1 : 120;

  const projected: FluxoBoletoRow[] = [];

  for (let i = 1; i <= maxIndex; i++) {
    const due =
      master.series_type === "recurring" && master.recurrence_frequency
        ? addPeriod(anchor, master.recurrence_frequency, i)
        : addMonthsPreserveDay(anchor, i);
    const dueYmd = formatYmd(due);
    const occMonth = monthKeyFromYmd(dueYmd);

    if (!isMonthInRange(occMonth, rangeStartYmd, rangeEndYmd)) {
      if (due > parseYmd(rangeEndYmd) && total != null) break;
      if (due > parseYmd(rangeEndYmd) && total == null) continue;
      if (due < parseYmd(rangeStartYmd)) continue;
    }

    if (suppressed.has(occMonth)) continue;

    const params = resolveOccurrenceParams(master, occMonth, i);
    projected.push(buildProjectedRow(master, i, occMonth, params));

    if (total != null && i >= total - 1) break;
  }

  return projected;
}

export function mergeFluxoBoletos(
  realBoletos: Boleto[],
  masters: ExpenseSeriesMaster[],
  rangeStartYmd: string,
  rangeEndYmd: string,
): FluxoBoletoRow[] {
  const realRows: FluxoBoletoRow[] = realBoletos.map((b) => ({
    ...b,
    is_projected: false,
    is_series_exception: !!b.expense_id,
  }));

  const projected = masters.flatMap((m) =>
    projectSeriesOccurrencesInRange(m, rangeStartYmd, rangeEndYmd),
  );

  const projectedByMasterMonth = new Set(
    projected.map(
      (p) =>
        `${p.series_master_expense_id}:${monthKeyFromYmd(p.due_date)}`,
    ),
  );
  const masterIds = new Set(masters.map((m) => m.id));

  const filteredReal = realRows.filter((b) => {
    if (!b.expense_id) return true;
    const mk = monthKeyFromYmd(b.due_date);
    if (!masterIds.has(b.expense_id)) return true;
    return !projectedByMasterMonth.has(`${b.expense_id}:${mk}`);
  });

  return [...filteredReal, ...projected].sort((a, b) =>
    a.due_date.localeCompare(b.due_date),
  );
}

export function filterBoletosBySearch(
  rows: FluxoBoletoRow[],
  search: string,
): FluxoBoletoRow[] {
  const term = search.trim().toLowerCase();
  if (!term) return rows;
  return rows.filter((b) => {
    const hay = `${b.description} ${b.provider ?? ""}`.toLowerCase();
    return hay.includes(term);
  });
}

export { normalizeAdjustments, normalizeSuppressed, monthsBetweenInclusive };

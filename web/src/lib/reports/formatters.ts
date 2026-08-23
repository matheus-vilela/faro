import { formatBrl } from "@/lib/dre/formatBrl";
import { formatIsoDateBr } from "@/lib/formatMoneyPtBr";
import { getMonthYmdRange, shiftMonthsYmd } from "@/lib/payableTotals";
import { localDateYmd } from "@/lib/boletoPayment";
import type { ReportFilterState, ReportRow } from "./types";

export function csvEscape(value: string): string {
  if (/[";,\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function formatReportDate(value: unknown): string {
  if (value == null || value === "") return "";
  return formatIsoDateBr(String(value));
}

export function formatReportMoney(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return formatBrl(n);
}

export function formatReportNumber(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export function cellToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return String(value);
}

export function sanitizeFilenamePart(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\w-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
}

export function buildReportFilename(parts: {
  slug: string;
  companyName: string;
  dateFrom?: string;
  dateTo?: string;
}): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const company = sanitizeFilenamePart(parts.companyName || "empresa");
  const range =
    parts.dateFrom && parts.dateTo
      ? `${parts.dateFrom}_${parts.dateTo}`
      : "";
  return ["relatorio", parts.slug, company, range, stamp]
    .filter(Boolean)
    .join("_");
}

export function currentMonthFilters(): Pick<
  ReportFilterState,
  "dateFrom" | "dateTo" | "month" | "year"
> {
  const today = localDateYmd();
  const [y, m] = today.split("-").map(Number);
  const month = m || 1;
  const year = y || 1970;
  const { startYmd, endYmd } = getMonthYmdRange(month, year);
  return { dateFrom: startYmd, dateTo: endYmd, month, year };
}

export function lookbackFromFilters(): Pick<
  ReportFilterState,
  "dateFrom" | "dateTo" | "month" | "year"
> {
  const today = localDateYmd();
  const [y, m] = today.split("-").map(Number);
  return {
    dateFrom: shiftMonthsYmd(today, -24),
    dateTo: today,
    month: m || 1,
    year: y || 1970,
  };
}

export function defaultReportFilters(
  overrides?: Partial<ReportFilterState>,
): ReportFilterState {
  const month = currentMonthFilters();
  return {
    ...month,
    dateField: "due_date",
    openDueBucket: "all",
    categoryId: "all",
    supplierId: "all",
    search: "",
    bankAccountId: "all",
    basis: "competencia",
    natureza: "all",
    flowType: "both",
    situation: "all",
    expenseStatus: "all",
    expenseOrigin: "all",
    reconStatus: "all",
    dreView: "resumo",
    stockMode: "filtered",
    scenario: "base",
    horizonWeeks: 8,
    openingBalance: 0,
    cmvPeriod: "last7",
    movementDirection: "all",
    ...overrides,
  };
}

export function periodLabel(from: string, to: string): string {
  if (!from && !to) return "";
  if (from && to) {
    return `${formatIsoDateBr(from)} a ${formatIsoDateBr(to)}`;
  }
  return formatIsoDateBr(from || to);
}

export function monthYearLabel(month: number, year: number): string {
  const names = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];
  return `${names[month - 1] ?? month} ${year}`;
}

export function rowHasValue(row: ReportRow): boolean {
  return Object.values(row).some((v) => v != null && v !== "");
}

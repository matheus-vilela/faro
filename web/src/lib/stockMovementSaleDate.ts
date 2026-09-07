import {
  isExpenseStockMovementReference,
  resolveExpenseIdsForStockMovements,
} from "@/lib/stockMovementExpenseLink";
import { supabase } from "@/lib/supabase";

const YMD = /^(\d{4})-(\d{2})-(\d{2})/;

const REVENUE_REFS = new Set([
  "revenue_entry",
  "revenue_entry_update",
  "revenue_entry_delete",
]);

export type StockMovementDateRow = {
  id?: string;
  created_at: string;
  reference_type?: string | null;
  reference_id?: string | null;
  expense_id?: string | null;
  /** JSON livre; `sale_date` (PDV) e `purchase_date` (nota) entram na data efetiva. */
  metadata_json?: unknown;
};

const IN_CHUNK = 200;

function metadataRecord(metadata: unknown): Record<string, unknown> {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return {};
}

function ymdFromUnknown(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const ymd = raw.trim().slice(0, 10);
  return YMD.test(ymd) ? ymd : null;
}

export function stockMovementSaleDateYmd(metadata: unknown): string | null {
  return ymdFromUnknown(metadataRecord(metadata).sale_date);
}

export function stockMovementPurchaseDateYmd(metadata: unknown): string | null {
  return ymdFromUnknown(metadataRecord(metadata).purchase_date);
}

/** Data de negócio: venda PDV, senão compra da nota. */
export function stockMovementSourceDateYmd(metadata: unknown): string | null {
  return (
    stockMovementSaleDateYmd(metadata) ?? stockMovementPurchaseDateYmd(metadata)
  );
}

function dateFromYmd(ymd: string): Date | null {
  const m = YMD.exec(ymd);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatSourceDate(ymd: string, withYear: boolean): string {
  const date = dateFromYmd(ymd);
  if (!date) return ymd;
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    ...(withYear ? { year: "numeric" as const } : {}),
  });
}

/** Data exibida: venda, senão compra, senão `created_at`. */
export function formatStockMovementListDate(
  row: StockMovementDateRow,
  opts?: { withYear?: boolean },
): string {
  const source = stockMovementSourceDateYmd(row.metadata_json);
  if (source) return formatSourceDate(source, opts?.withYear === true);
  return new Date(row.created_at).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    ...(opts?.withYear ? { year: "numeric" as const } : {}),
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isRevenueRef(referenceType: string | null | undefined): boolean {
  return REVENUE_REFS.has((referenceType ?? "").trim().toLowerCase());
}

function createdAtLocalYmd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "0000-00-00";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Dia usado na ordem da lista: venda, senão compra, senão o dia local de created_at. */
export function stockMovementEffectiveYmd(row: StockMovementDateRow): string {
  return (
    stockMovementSourceDateYmd(row.metadata_json) ??
    createdAtLocalYmd(row.created_at)
  );
}

export function sortStockMovementsByEffectiveDate<T extends StockMovementDateRow>(
  rows: T[],
  direction: "asc" | "desc" = "desc",
): T[] {
  const sign = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const ya = stockMovementEffectiveYmd(a);
    const yb = stockMovementEffectiveYmd(b);
    if (ya !== yb) return ya < yb ? -sign : sign;
    const ca = new Date(a.created_at).getTime();
    const cb = new Date(b.created_at).getTime();
    if (ca !== cb) return (ca - cb) * sign;
    return String(a.id ?? "").localeCompare(String(b.id ?? "")) * sign;
  });
}

/** Completa `sale_date` com `revenue_entries.entry_date` quando o metadata não tem. */
export async function attachRevenueSaleDates<T extends StockMovementDateRow>(
  rows: T[],
): Promise<T[]> {
  const ids = [
    ...new Set(
      rows
        .filter(
          (r) =>
            !stockMovementSaleDateYmd(r.metadata_json) &&
            isRevenueRef(r.reference_type) &&
            r.reference_id,
        )
        .map((r) => r.reference_id as string),
    ),
  ];
  if (ids.length === 0) return rows;

  const byId = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const chunk = ids.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from("revenue_entries")
      .select("id, entry_date")
      .in("id", chunk);
    if (error) {
      console.error(error);
      return rows;
    }
    for (const e of data ?? []) {
      byId.set(e.id as string, ymdFromUnknown(e.entry_date));
    }
  }

  return rows.map((r) => {
    if (stockMovementSaleDateYmd(r.metadata_json) || !r.reference_id) return r;
    const entryDate = byId.get(r.reference_id);
    if (!entryDate) return r;
    return {
      ...r,
      metadata_json: {
        ...metadataRecord(r.metadata_json),
        sale_date: entryDate,
      },
    };
  });
}

function rowKey(row: StockMovementDateRow): string | null {
  return row.id ?? row.reference_id ?? null;
}

/** Completa `purchase_date` com `expenses.reference_date` (emissão/competência da NF). */
export async function attachExpensePurchaseDates<T extends StockMovementDateRow>(
  rows: T[],
): Promise<T[]> {
  const needPurchase = rows.filter(
    (r) =>
      !stockMovementSourceDateYmd(r.metadata_json) &&
      (r.expense_id ||
        (isExpenseStockMovementReference(r.reference_type ?? null) &&
          r.reference_id)),
  );
  if (needPurchase.length === 0) return rows;

  const needResolve = needPurchase.filter(
    (r) =>
      !r.expense_id &&
      isExpenseStockMovementReference(r.reference_type ?? null) &&
      r.reference_id,
  );
  const resolved =
    needResolve.length > 0
      ? await resolveExpenseIdsForStockMovements(needResolve)
      : [];

  const expenseIdByKey = new Map<string, string>();
  for (const r of needPurchase) {
    const key = rowKey(r);
    if (r.expense_id && key) expenseIdByKey.set(key, r.expense_id);
  }
  for (const r of resolved) {
    const key = rowKey(r);
    if (r.expense_id && key) expenseIdByKey.set(key, r.expense_id);
  }

  const expenseIds = [...new Set(expenseIdByKey.values())];
  if (expenseIds.length === 0) return rows;

  const dateByExpenseId = new Map<string, string | null>();
  for (let i = 0; i < expenseIds.length; i += IN_CHUNK) {
    const chunk = expenseIds.slice(i, i + IN_CHUNK);
    const { data, error } = await supabase
      .from("expenses")
      .select("id, reference_date")
      .in("id", chunk);
    if (error) {
      console.error(error);
      return rows;
    }
    for (const e of data ?? []) {
      dateByExpenseId.set(e.id as string, ymdFromUnknown(e.reference_date));
    }
  }

  return rows.map((r) => {
    if (stockMovementSourceDateYmd(r.metadata_json)) return r;
    const key = rowKey(r);
    const expenseId = key ? expenseIdByKey.get(key) : undefined;
    const purchaseDate = expenseId
      ? dateByExpenseId.get(expenseId) ?? undefined
      : undefined;
    if (!purchaseDate) return r;
    return {
      ...r,
      metadata_json: {
        ...metadataRecord(r.metadata_json),
        purchase_date: purchaseDate,
      },
    };
  });
}

/** Anexa data da venda (PDV) e da compra (nota) para exibição e ordem. */
export async function attachStockMovementSourceDates<
  T extends StockMovementDateRow,
>(rows: T[]): Promise<T[]> {
  const withSales = await attachRevenueSaleDates(rows);
  return attachExpensePurchaseDates(withSales);
}

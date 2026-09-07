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
  /** JSON livre; só `sale_date` entra na data efetiva. */
  metadata_json?: unknown;
};

const IN_CHUNK = 200;

function metadataRecord(
  metadata: unknown,
): Record<string, unknown> {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return {};
}

export function stockMovementSaleDateYmd(metadata: unknown): string | null {
  const raw = metadataRecord(metadata).sale_date;
  if (typeof raw !== "string") return null;
  const ymd = raw.trim().slice(0, 10);
  return YMD.test(ymd) ? ymd : null;
}

function dateFromYmd(ymd: string): Date | null {
  const m = YMD.exec(ymd);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatSaleDate(ymd: string, withYear: boolean): string {
  const date = dateFromYmd(ymd);
  if (!date) return ymd;
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    ...(withYear ? { year: "numeric" as const } : {}),
  });
}

/** Data exibida: `sale_date` (ou entry_date anexado) tem prioridade sobre `created_at`. */
export function formatStockMovementListDate(
  row: StockMovementDateRow,
  opts?: { withYear?: boolean },
): string {
  const sale = stockMovementSaleDateYmd(row.metadata_json);
  if (sale) return formatSaleDate(sale, opts?.withYear === true);
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

/** Dia usado na ordem da lista: sale_date, senão o dia local de created_at. */
export function stockMovementEffectiveYmd(row: StockMovementDateRow): string {
  return stockMovementSaleDateYmd(row.metadata_json) ?? createdAtLocalYmd(row.created_at);
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
      const ymd =
        typeof e.entry_date === "string" ? e.entry_date.slice(0, 10) : "";
      byId.set(e.id as string, YMD.test(ymd) ? ymd : null);
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

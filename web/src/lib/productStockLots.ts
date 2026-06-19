export type ProductStockLotEntry = {
  id: string;
  quantity: number;
  expiry_date: string;
  stock_movement_id?: string | null;
  created_at?: string;
};

export type LotExpiryStatus = "ok" | "near" | "expired";

const NEAR_EXPIRY_DAYS = 5;

function parseLocalDate(dateStr: string): Date | null {
  const trimmed = dateStr.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(`${trimmed}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfLocalDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function parseProductStockLots(raw: unknown): ProductStockLotEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductStockLotEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const expiry = String(row.expiry_date ?? "").trim().slice(0, 10);
    const qty = Number(row.quantity);
    if (!expiry || !Number.isFinite(qty) || qty <= 0) continue;
    out.push({
      id: String(row.id ?? crypto.randomUUID()),
      quantity: qty,
      expiry_date: expiry,
      stock_movement_id:
        row.stock_movement_id != null
          ? String(row.stock_movement_id)
          : null,
      created_at:
        row.created_at != null ? String(row.created_at) : undefined,
    });
  }
  return out.sort((a, b) => {
    const da = parseLocalDate(a.expiry_date)?.getTime() ?? 0;
    const db = parseLocalDate(b.expiry_date)?.getTime() ?? 0;
    if (da !== db) return da - db;
    return (b.created_at ?? "").localeCompare(a.created_at ?? "");
  });
}

export function lotExpiryStatus(
  expiryDate: string,
  referenceDate: Date = new Date(),
): LotExpiryStatus {
  const expiry = parseLocalDate(expiryDate);
  if (!expiry) return "ok";
  const today = startOfLocalDay(referenceDate);
  const expDay = startOfLocalDay(expiry);
  if (expDay < today) return "expired";
  const nearLimit = new Date(today);
  nearLimit.setDate(nearLimit.getDate() + NEAR_EXPIRY_DAYS);
  if (expDay <= nearLimit) return "near";
  return "ok";
}

export function formatLotExpiryDate(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  if (!d) return dateStr;
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function summarizeLotAlerts(
  lots: ProductStockLotEntry[],
  referenceDate: Date = new Date(),
): { hasExpired: boolean; hasNearExpiry: boolean; totalInLots: number } {
  let hasExpired = false;
  let hasNearExpiry = false;
  let totalInLots = 0;
  for (const lot of lots) {
    const qty = Number(lot.quantity);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    totalInLots += qty;
    const status = lotExpiryStatus(lot.expiry_date, referenceDate);
    if (status === "expired") hasExpired = true;
    if (status === "near") hasNearExpiry = true;
  }
  return { hasExpired, hasNearExpiry, totalInLots };
}

export const LOT_EXPIRY_STATUS_LABEL: Record<LotExpiryStatus, string> = {
  ok: "No prazo",
  near: "Próximo ao vencimento",
  expired: "Vencido",
};

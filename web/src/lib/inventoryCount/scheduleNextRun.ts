export const INVENTORY_COUNT_WEEKDAY_LABELS = [
  "Dom",
  "Seg",
  "Ter",
  "Qua",
  "Qui",
  "Sex",
  "Sáb",
] as const;

export type InventoryCountRecurrenceKind =
  | "once"
  | "every_n_days"
  | "alt_weeks";

export type InventoryCountScheduleRecurrence = {
  recurrence_kind: InventoryCountRecurrenceKind;
  interval_days?: number | null;
  weekday?: number | null;
};

export function toDatetimeLocalValue(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function datetimeLocalToIso(value: string): string | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function formatScheduleWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRecurrenceLabel(
  rec: InventoryCountScheduleRecurrence,
): string {
  if (rec.recurrence_kind === "once") return "Única";
  if (rec.recurrence_kind === "every_n_days") {
    const n = Math.max(1, Number(rec.interval_days ?? 1));
    return n === 1 ? "Todos os dias" : `A cada ${n} dias`;
  }
  const wd = Number(rec.weekday ?? 0);
  const label = INVENTORY_COUNT_WEEKDAY_LABELS[wd] ?? "Dom";
  return `Semana sim / semana não · ${label}`;
}

/** Próxima ocorrência depois de `from` (não gera sessão antecipada). */
export function nextRunAfter(
  from: Date,
  rec: InventoryCountScheduleRecurrence,
): Date | null {
  if (rec.recurrence_kind === "once") return null;
  if (rec.recurrence_kind === "every_n_days") {
    const n = Math.max(1, Math.floor(Number(rec.interval_days ?? 1)));
    return new Date(from.getTime() + n * 86400000);
  }
  return new Date(from.getTime() + 14 * 86400000);
}

export function snapToWeekday(date: Date, weekday: number): Date {
  const next = new Date(date.getTime());
  const current = next.getDay();
  const target = ((weekday % 7) + 7) % 7;
  const delta = (target - current + 7) % 7;
  next.setDate(next.getDate() + delta);
  return next;
}

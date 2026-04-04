/** America/Sao_Paulo — sem DST desde 2019; meia-noite local = UTC+3h no mesmo dia civil. */
const TZ = "America/Sao_Paulo";

export type ChecklistRecurrenceMeta = {
  recurrence_kind: "daily" | "monthly";
  daily_executions_per_day: number | null;
  weekday_mask: number;
  monthly_executions: number | null;
};

export function getWeekdaySP(d: Date): number {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
  }).format(d);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const k = s.slice(0, 3);
  return map[k] ?? 0;
}

/** Meia-noite (00:00) em SP para o dia civil YYYY-MM-DD → instante UTC em ms. */
export function spMidnightUtcMs(ymd: string): number {
  const [y, m, day] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, day, 3, 0, 0, 0);
}

export function spYmdInTz(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

export function todayBoundsSP(now: Date): { start: number; end: number } {
  const ymd = spYmdInTz(now);
  const start = spMidnightUtcMs(ymd);
  const [y, mo, da] = ymd.split("-").map(Number);
  const next = new Date(Date.UTC(y, mo - 1, da, 3, 0, 0, 0));
  next.setUTCDate(next.getUTCDate() + 1);
  return { start, end: next.getTime() - 1 };
}

export function monthBoundsSP(now: Date): { start: number; end: number } {
  const ym = now.toLocaleString("en-CA", { timeZone: TZ }).slice(0, 7);
  const startYmd = `${ym}-01`;
  const start = spMidnightUtcMs(startYmd);
  const [yStr, mStr] = ym.split("-");
  let y = parseInt(yStr!, 10);
  let m = parseInt(mStr!, 10);
  m += 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  const nextYmd = `${y}-${String(m).padStart(2, "0")}-01`;
  return { start, end: spMidnightUtcMs(nextYmd) - 1 };
}

export function countSubmittedInBounds(
  runs: { checklist_id: string; submitted_at: string }[],
  checklistId: string,
  startMs: number,
  endMs: number,
): number {
  return runs.filter((r) => {
    if (r.checklist_id !== checklistId) return false;
    const t = new Date(r.submitted_at).getTime();
    return t >= startMs && t <= endMs;
  }).length;
}

export function shortRecurrenceHint(
  meta: ChecklistRecurrenceMeta,
  expectedInPeriod: number,
): string {
  if (meta.recurrence_kind === "monthly") {
    const n = meta.monthly_executions ?? 1;
    return `mensal · ${n}× no mês`;
  }

  return `diário`;
}

/** Diário em dia sem máscara (folga): não entra no menu. Mensal sempre entra (meta no mês ou já concluído). */
export function includeInWhatsappMenu(
  meta: ChecklistRecurrenceMeta,
  expectedInPeriod: number,
): boolean {
  if (meta.recurrence_kind === "monthly") return true;
  return expectedInPeriod > 0;
}

export function progressForChecklist(
  meta: ChecklistRecurrenceMeta,
  runs: { checklist_id: string; submitted_at: string }[],
  checklistId: string,
  now: Date,
): { actual: number; expected: number } {
  if (meta.recurrence_kind === "monthly") {
    const expected = meta.monthly_executions ?? 1;
    const { start, end } = monthBoundsSP(now);
    const actual = countSubmittedInBounds(runs, checklistId, start, end);
    return { actual, expected };
  }
  const dow = getWeekdaySP(now);
  const inMask = (meta.weekday_mask & (1 << dow)) !== 0;
  const expected = inMask ? (meta.daily_executions_per_day ?? 1) : 0;
  const { start, end } = todayBoundsSP(now);
  const actual = countSubmittedInBounds(runs, checklistId, start, end);
  return { actual, expected };
}

export function formatChecklistMenuLine(
  index1Based: number,
  title: string,
  hint: string,
  actual: number,
  expected: number,
): string {
  const t = title.trim() || "Checklist";
  const rec = hint ? ` · ${hint}` : "";

  const ratio = `(${actual}/${expected})`;
  if (actual >= expected) {
    return `${index1Based}) ~${t}~ ${ratio}${rec}`;
  }
  return `${index1Based}) ${t} ${ratio}${rec}`;
}

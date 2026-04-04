/** America/Sao_Paulo — sem DST desde 2019; passos de 24h são seguros. */
const TZ = "America/Sao_Paulo";

export type ChecklistRecurrenceMeta = {
  recurrence_kind: "daily" | "monthly";
  daily_executions_per_day: number | null;
  weekday_mask: number;
  monthly_executions: number | null;
};

const WD_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

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

/** Meta esperada em janela rolante de N dias (inclui hoje como último dia). */
export function expectedCompletionsRolling(
  meta: ChecklistRecurrenceMeta,
  daysInclusive: number,
  now: Date = new Date(),
): number {
  const n = Math.max(1, Math.floor(daysInclusive));
  const end = now.getTime();

  if (meta.recurrence_kind === "monthly") {
    const perMonth = meta.monthly_executions ?? 1;
    const months = new Set<string>();
    for (let i = 0; i < n; i++) {
      const d = new Date(end - i * 86400000);
      const ym = d.toLocaleString("en-CA", { timeZone: TZ }).slice(0, 7);
      months.add(ym);
    }
    return months.size * perMonth;
  }

  const perDay = meta.daily_executions_per_day ?? 1;
  const mask = meta.weekday_mask;
  let expected = 0;
  for (let i = 0; i < n; i++) {
    const d = new Date(end - i * 86400000);
    const dow = getWeekdaySP(d);
    if ((mask & (1 << dow)) !== 0) expected += perDay;
  }
  return expected;
}

export function formatRecurrenceSummary(meta: ChecklistRecurrenceMeta): string {
  if (meta.recurrence_kind === "monthly") {
    const n = meta.monthly_executions ?? 1;
    return `${n}× por mês (mensal)`;
  }
  const per = meta.daily_executions_per_day ?? 1;
  const mask = meta.weekday_mask;
  const days = WD_SHORT.filter((_, i) => (mask & (1 << i)) !== 0).join(", ");
  return `${per}× por dia · ${days || "—"}`;
}

export function toggleWeekdayBit(mask: number, weekday: number): number {
  const bit = 1 << weekday;
  const next = mask ^ bit;
  return next === 0 ? mask : next;
}

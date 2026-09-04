/** Limites UTC para um dia civil em America/Sao_Paulo (UTC−3 fixo). */
export function spCivilDayBoundsUtc(ymd: string): { startIso: string; endIso: string } {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) throw new Error("invalid ymd");
  const startMs = Date.UTC(y, m - 1, d, 3, 0, 0, 0);
  const endMs = startMs + 86400000 - 1;
  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}

export function spTodayYmd(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Sao_Paulo",
  });
}

export function isoToSpYmd(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", {
    timeZone: "America/Sao_Paulo",
  });
}

/** Soma dias no calendário de SP (ymd YYYY-MM-DD). */
export function spAddCalendarDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
  noon.setUTCDate(noon.getUTCDate() + delta);
  return noon.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export function spCivilRangeBoundsUtc(
  startYmd: string,
  endYmd: string,
): { startIso: string; endIso: string } {
  let a = startYmd;
  let b = endYmd;
  if (a > b) [a, b] = [b, a];
  const { startIso } = spCivilDayBoundsUtc(a);
  const { endIso } = spCivilDayBoundsUtc(b);
  return { startIso, endIso };
}

export function spWeekdayFromYmd(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0));
  return getSpWeekdayFromDate(noon);
}

function getSpWeekdayFromDate(d: Date): number {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
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
  return map[s.slice(0, 3)] ?? 0;
}

/** Segunda-feira da semana ISO (Seg–Dom) em SP. */
export function spMondayOfWeek(ymd: string): string {
  const wd = spWeekdayFromYmd(ymd);
  const delta = wd === 0 ? -6 : 1 - wd;
  return spAddCalendarDays(ymd, delta);
}

export function spMonthStartYmd(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

export function spMonthEndYmd(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0, 12, 0, 0, 0));
  return last.toISOString().slice(0, 10);
}

export function listSpYmdsInclusive(startYmd: string, endYmd: string): string[] {
  let a = startYmd;
  let b = endYmd;
  if (a > b) [a, b] = [b, a];
  const out: string[] = [];
  let cur = a;
  while (cur <= b) {
    out.push(cur);
    cur = spAddCalendarDays(cur, 1);
    if (out.length > 400) break;
  }
  return out;
}

export function minYmd(a: string, b: string): string {
  return a <= b ? a : b;
}

export function spNowHms(): string {
  return new Date().toLocaleTimeString("en-GB", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** Dia anterior a hoje = vencido. Hoje = depois do prazo (deadline ou fim da janela). */
export function isChecklistSlotPastDue(
  ymd: string,
  todayYmd: string,
  deadlineOrWindowEnd: string | null | undefined,
): boolean {
  if (ymd < todayYmd) return true;
  if (ymd > todayYmd) return false;
  const limit = deadlineOrWindowEnd?.trim();
  if (!limit) return false;
  const norm = limit.length >= 8 ? limit.slice(0, 8) : `${limit}:00`.slice(0, 8);
  return spNowHms() > norm;
}

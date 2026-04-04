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

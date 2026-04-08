/**
 * Dias até o vencimento em calendário local (0 = hoje, 1 = amanhã, 3 = em 3 dias).
 * `dueDateStr` no formato ISO `YYYY-MM-DD` ou início de timestamp.
 */
export function calendarDaysFromTodayToDueDate(dueDateStr: string): number {
  const part = dueDateStr.slice(0, 10);
  const [y, m, d] = part.split("-").map(Number);
  if (!y || !m || !d) return NaN;
  const due = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

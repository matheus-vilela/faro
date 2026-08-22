/** Primeiro e último dia do mês em YYYY-MM-DD (calendário local). */
export function monthYmdBounds(
  month: number,
  year: number,
): { min: string; max: string } {
  const lastDay = new Date(year, month, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    min: `${year}-${pad(month)}-01`,
    max: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

/** Garante gte <= lte mesmo se o usuário inverter início e fim. */
export function orderedYmdRange(
  from: string,
  to: string,
): { gte: string; lte: string } {
  if (from && to && from > to) return { gte: to, lte: from };
  return { gte: from, lte: to };
}

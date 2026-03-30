export type CalendarCellDate = {
  day: number;
  month: number;
  year: number;
  inCurrentMonth: boolean;
};

/** Colunas domingo → sábado (getDay: 0 = domingo). */
function sundayFirstOffset(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

/** Grade 6×7: semanas dom–sáb; inclui dias do mês anterior e seguinte. */
export function buildCalendarCells(
  year: number,
  month: number,
): CalendarCellDate[] {
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysInPrevMonth = new Date(year, month - 1, 0).getDate();
  const offset = sundayFirstOffset(year, month);
  const cells: CalendarCellDate[] = [];

  for (let i = 0; i < offset; i++) {
    const day = daysInPrevMonth - offset + i + 1;
    const pm = month === 1 ? 12 : month - 1;
    const py = month === 1 ? year - 1 : year;
    cells.push({ day, month: pm, year: py, inCurrentMonth: false });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, month, year, inCurrentMonth: true });
  }

  const trail = new Date(year, month, 1);
  while (cells.length % 7 !== 0) {
    cells.push({
      day: trail.getDate(),
      month: trail.getMonth() + 1,
      year: trail.getFullYear(),
      inCurrentMonth: false,
    });
    trail.setDate(trail.getDate() + 1);
  }

  while (cells.length < 35) {
    cells.push({
      day: trail.getDate(),
      month: trail.getMonth() + 1,
      year: trail.getFullYear(),
      inCurrentMonth: false,
    });
    trail.setDate(trail.getDate() + 1);
  }

  return cells;
}

/** Intervalo para buscar boletos visíveis na grade (inclui meses adjacentes). */
export function getCalendarGridDateRange(
  month: number,
  year: number,
): { startIso: string; endIso: string } {
  const cells = buildCalendarCells(year, month);
  const first = cells[0];
  const last = cells[cells.length - 1];
  const startIso = `${first.year}-${String(first.month).padStart(2, "0")}-${String(first.day).padStart(2, "0")}`;
  const endIso = `${last.year}-${String(last.month).padStart(2, "0")}-${String(last.day).padStart(2, "0")}`;
  return { startIso, endIso };
}

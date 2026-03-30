import { Button } from "@/components/ui/button";
import { BOLETO_CATEGORY_SHORT } from "@/lib/boletoCategory";
import { buildCalendarCells } from "@/lib/boletosCalendarGrid";
import { cn } from "@/lib/utils";
import type { Boleto, BoletoCategory } from "@/types/expense";

function categoryShort(c?: BoletoCategory | null): string {
  return BOLETO_CATEGORY_SHORT[c ?? "outros"];
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function groupByDueDate(boletos: Boleto[]): Map<string, Boleto[]> {
  const m = new Map<string, Boleto[]>();
  for (const b of boletos) {
    const key = b.due_date.slice(0, 10);
    const arr = m.get(key) ?? [];
    arr.push(b);
    m.set(key, arr);
  }
  for (const [, arr] of m) {
    arr.sort((a, b) => a.amount - b.amount);
  }
  return m;
}

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function isToday(y: number, m: number, d: number): boolean {
  const t = new Date();
  return t.getFullYear() === y && t.getMonth() + 1 === m && t.getDate() === d;
}

const MAX_PREVIEW_IN_CELL = 2;

function formatDayHeading(y: number, m: number, d: number): string {
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export type CalendarDayListPayload = {
  /** YYYY-MM-DD */
  dateKey: string;
  title: string;
  items: Boleto[];
};

interface BoletosCalendarProps {
  month: number;
  year: number;
  boletos: Boleto[];
  loading: boolean;
  onDayListOpen: (payload: CalendarDayListPayload) => void;
  onDayBoletoClick: (b: Boleto) => void;
  formatCurrency: (v: number) => string;
}

export function BoletosCalendar({
  month,
  year,
  boletos,
  loading,
  onDayListOpen,
  onDayBoletoClick,
  formatCurrency,
}: BoletosCalendarProps) {
  const byDay = groupByDueDate(boletos);
  const cells = buildCalendarCells(year, month);

  if (loading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed bg-muted/20">
        <p className="text-sm text-muted-foreground">Carregando calendário…</p>
      </div>
    );
  }

  return (
    <div className="">
      <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
        <div className="min-w-[640px] ">
          <div className="grid grid-cols-7 gap-px rounded-lg bg-border/40 p-px">
            {WEEKDAYS.map((w) => (
              <div
                key={w}
                className="bg-muted/50 px-1 py-2 text-center text-xs font-medium text-muted-foreground sm:text-sm"
              >
                {w}
              </div>
            ))}
            {cells.map((cell, i) => {
              const dateStr = dateKey(cell.year, cell.month, cell.day);
              const list = byDay.get(dateStr) ?? [];
              const today = isToday(cell.year, cell.month, cell.day);
              const isWeekend = (() => {
                // const js = new Date(
                //   cell.year,
                //   cell.month - 1,
                //   cell.day,
                // ).getDay();
                // return js === 0 || js === 6;
                return false;
              })();
              const isAdjacent = !cell.inCurrentMonth;

              const dayListPayload: CalendarDayListPayload = {
                dateKey: dateStr,
                title: formatDayHeading(cell.year, cell.month, cell.day),
                items: list,
              };

              return (
                <div
                  key={`${dateStr}-${i}`}
                  role="presentation"
                  onClick={() => onDayListOpen(dayListPayload)}
                  className={cn(
                    "relative flex min-h-[100px] cursor-pointer flex-col overflow-hidden border-t border-l transition-colors hover:bg-muted/5 sm:min-h-[120px]",
                    !isAdjacent && "bg-background",
                    !isAdjacent && isWeekend && "bg-muted/20",
                    isAdjacent && "border-border bg-muted/30",
                    today &&
                      cell.inCurrentMonth &&
                      "ring-2 ring-primary/50 ring-inset sm:ring-[3px]",
                  )}
                >
                  {isAdjacent && (
                    <div
                      className="pointer-events-none absolute inset-0 z-0 backdrop-blur-[6px] sm:backdrop-blur-sm"
                      aria-hidden
                    />
                  )}
                  <div
                    className={cn(
                      "relative z-1 flex min-h-0 flex-1 flex-col p-1 sm:p-1.5",
                      isAdjacent && "opacity-90",
                    )}
                  >
                    <div
                      className={cn(
                        "mb-1 flex shrink-0 items-center justify-between text-xs font-semibold",
                        today && cell.inCurrentMonth
                          ? "text-primary"
                          : isAdjacent
                            ? "text-muted-foreground"
                            : "text-foreground",
                      )}
                    >
                      <span>{cell.day}</span>
                      {list.length > 0 && (
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                            isAdjacent
                              ? "bg-muted-foreground/15 text-muted-foreground"
                              : "bg-primary/10 text-primary",
                          )}
                        >
                          {list.length}
                        </span>
                      )}
                    </div>
                    <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
                      {list.length === 0 ? (
                        <span
                          className={cn(
                            "text-[10px] sm:text-xs",
                            isAdjacent
                              ? "text-muted-foreground/50"
                              : "text-muted-foreground/70",
                          )}
                        >
                          —
                        </span>
                      ) : (
                        <>
                          {list.slice(0, MAX_PREVIEW_IN_CELL).map((b) => (
                            <button
                              key={b.id}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDayBoletoClick(b);
                              }}
                              className={cn(
                                "w-full rounded-md border px-1 py-1 text-left text-[10px] leading-tight transition-colors sm:text-xs",
                                b.status === "paid"
                                  ? "border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted/60"
                                  : "border-primary/25 bg-primary/10 text-foreground hover:bg-primary/15 dark:border-primary/35 dark:bg-primary/15 dark:hover:bg-primary/20",
                              )}
                            >
                              <span className="line-clamp-1 font-medium ">
                                {b.description}
                              </span>

                              <div className="flex items-center justify-between">
                                <span className="mt-0.5 block font-semibold tabular-nums text-primary">
                                  {formatCurrency(b.amount)}
                                </span>
                                <span className="mt-0.5 text-[9px] text-muted-foreground sm:text-[10px] flex items-center gap-1">
                                  <span className="mt-0.5 block text-[9px] text-primary/90 sm:text-[10px]">
                                    {categoryShort(b.category)}
                                  </span>
                                  {b.status === "paid" ? " · Pago" : ""}
                                </span>
                              </div>
                            </button>
                          ))}
                          {list.length > MAX_PREVIEW_IN_CELL && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 shrink-0 text-[10px] font-medium sm:h-8 sm:text-xs"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDayListOpen(dayListPayload);
                              }}
                            >
                              Ver todos ({list.length})
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { buildCalendarCells } from "@/lib/boletosCalendarGrid";
import { cn } from "@/lib/utils";
import type { Boleto } from "@/types/expense";
import { isBoletoPayable } from "@/types/expense";

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

function dayTotals(items: Boleto[]): { payable: number; receivable: number } {
  let payable = 0;
  let receivable = 0;
  for (const b of items) {
    if (isBoletoPayable(b)) payable += b.amount;
    else receivable += b.amount;
  }
  return { payable, receivable };
}

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function isToday(y: number, m: number, d: number): boolean {
  const t = new Date();
  return t.getFullYear() === y && t.getMonth() + 1 === m && t.getDate() === d;
}

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
  formatCurrency: (v: number) => string;
}

export function BoletosCalendar({
  month,
  year,
  boletos,
  loading,
  onDayListOpen,
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
    <TooltipProvider delayDuration={200}>
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
                const { payable, receivable } = dayTotals(list);
                const today = isToday(cell.year, cell.month, cell.day);
                const isWeekend = (() => {
                  return false;
                })();
                const isAdjacent = !cell.inCurrentMonth;

                const dayListPayload: CalendarDayListPayload = {
                  dateKey: dateStr,
                  title: formatDayHeading(cell.year, cell.month, cell.day),
                  items: list,
                };

                const hasAny = list.length > 0;

                return (
                  <div
                    key={`${dateStr}-${i}`}
                    role="presentation"
                    onClick={() => onDayListOpen(dayListPayload)}
                    className={cn(
                      "relative flex min-h-[104px] cursor-pointer flex-col overflow-hidden border-t border-l transition-colors hover:bg-muted/5 sm:min-h-[118px]",
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
                          "mb-1 flex shrink-0 items-center justify-between gap-1 text-xs font-semibold",
                          today && cell.inCurrentMonth
                            ? "text-primary"
                            : isAdjacent
                              ? "text-muted-foreground"
                              : "text-foreground",
                        )}
                      >
                        <span className="tabular-nums">{cell.day}</span>
                        {hasAny && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                tabIndex={0}
                                className={cn(
                                  "inline-flex min-h-[22px] min-w-[22px] cursor-default items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                                  isAdjacent
                                    ? "bg-muted-foreground/15 text-muted-foreground"
                                    : "bg-primary/12 text-primary",
                                )}
                                onClick={(e) => e.stopPropagation()}
                                onPointerDown={(e) => e.stopPropagation()}
                              >
                                {list.length}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              className="max-w-[220px]"
                            >
                              — Lançamentos neste dia
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <div className="flex min-h-0 flex-1 flex-col justify-end gap-1">
                        {!hasAny ? (
                          <span
                            className={cn(
                              "text-right text-[10px] sm:text-xs",
                              isAdjacent
                                ? "text-muted-foreground/50"
                                : "text-muted-foreground/70",
                            )}
                          >
                            —
                          </span>
                        ) : (
                          <>
                            <div className="flex w-full flex-col gap-1">
                              {receivable > 0 && (
                                <div
                                  className={cn(
                                    "flex w-full min-w-0 overflow-hidden rounded-md border border-emerald-600/25 bg-emerald-500/[0.07] shadow-[inset_3px_0_0_0] shadow-emerald-600/75 dark:bg-emerald-500/10 dark:shadow-emerald-500/70",
                                    isAdjacent && "opacity-85",
                                  )}
                                >
                                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-1.5 py-1 sm:flex-row sm:items-center sm:justify-between sm:gap-1">
                                    <span className="text-left text-[6px] font-semibold uppercase leading-tight tracking-wide text-emerald-700 dark:text-emerald-400/95 sm:text-[7px]">
                                      Vendas realizadas no dia
                                    </span>
                                    <p
                                      className="text-right text-[9px] font-semibold tabular-nums leading-none text-emerald-600 dark:text-emerald-400 sm:text-[10px]"
                                      title="Contas a receber"
                                    >
                                      + {formatCurrency(receivable)}
                                    </p>
                                  </div>
                                </div>
                              )}
                              {payable > 0 && (
                                <div
                                  className={cn(
                                    "flex w-full min-w-0 overflow-hidden rounded-md border border-destructive/20 bg-destructive/[0.06] shadow-[inset_3px_0_0_0] shadow-destructive/70 dark:bg-destructive/10 dark:shadow-destructive/80",
                                    isAdjacent && "opacity-85",
                                  )}
                                >
                                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-1.5 py-1 sm:flex-row sm:items-center sm:justify-between sm:gap-1">
                                    <span className="text-left text-[6px] font-semibold uppercase leading-tight tracking-wide text-destructive/90 sm:text-[7px]">
                                      Valores a Pagar
                                    </span>
                                    <p
                                      className="text-right text-[9px] font-semibold tabular-nums leading-none text-destructive sm:text-[10px]"
                                      title="Contas a pagar"
                                    >
                                      − {formatCurrency(payable)}
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 w-full shrink-0 px-1 text-[9px] font-medium text-muted-foreground hover:text-foreground sm:h-7 sm:text-[10px]"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDayListOpen(dayListPayload);
                              }}
                            >
                              Detalhes
                            </Button>
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
    </TooltipProvider>
  );
}

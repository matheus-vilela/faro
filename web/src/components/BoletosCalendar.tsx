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

function dayTotals(
  items: Boleto[],
  options?: {
    splitPayableByReceipt?: (b: Boleto) => boolean;
    onlyScheduledPayables?: (b: Boleto) => boolean;
  },
): {
  payable: number;
  receivable: number;
  payableReady: number;
  payablePendingReceipt: number;
} {
  let payable = 0;
  let receivable = 0;
  let payableReady = 0;
  let payablePendingReceipt = 0;

  for (const b of items) {
    if (isBoletoPayable(b)) {
      if (options?.onlyScheduledPayables && !options.onlyScheduledPayables(b)) {
        continue;
      }
      payable += b.amount;
      if (options?.splitPayableByReceipt) {
        if (options.splitPayableByReceipt(b)) payableReady += b.amount;
        else payablePendingReceipt += b.amount;
      } else {
        payableReady += b.amount;
      }
    } else {
      receivable += b.amount;
    }
  }

  return { payable, receivable, payableReady, payablePendingReceipt };
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

function monthShortLabel(m: number, y: number): string {
  return new Date(y, m - 1, 1)
    .toLocaleDateString("pt-BR", { month: "short" })
    .replace(".", "");
}

export type CalendarDayListPayload = {
  /** YYYY-MM-DD */
  dateKey: string;
  title: string;
  items: Boleto[];
};

export type BoletosCalendarViewMode = "all" | "payable" | "receivable";

function filterBoletosForView(
  boletos: Boleto[],
  viewMode: BoletosCalendarViewMode,
): Boleto[] {
  if (viewMode === "all") return boletos;
  if (viewMode === "payable") return boletos.filter((b) => isBoletoPayable(b));
  return boletos.filter((b) => !isBoletoPayable(b));
}

interface BoletosCalendarProps {
  month: number;
  year: number;
  boletos: Boleto[];
  loading: boolean;
  onDayListOpen: (payload: CalendarDayListPayload) => void;
  formatCurrency: (v: number) => string;
  /** Quando definido, o calendário mostra só saídas ou só entradas (vendas realizadas). */
  viewMode?: BoletosCalendarViewMode;
  /** Quando definido, separa saídas entre valores a pagar e valores a confirmar (recebimento). */
  isPayableReadyToPay?: (b: Boleto) => boolean;
  /** Limita totais de saída a contas ainda agendadas (pendentes/projetadas). */
  onlyScheduledPayables?: (b: Boleto) => boolean;
}

type CalendarDayValueTone = "payable" | "pendingReceipt" | "receivable";

function CalendarDayValueBucket({
  label,
  amount,
  tone,
  formatCurrency,
  title,
  muted,
}: {
  label: string;
  amount: number;
  tone: CalendarDayValueTone;
  formatCurrency: (v: number) => string;
  title: string;
  muted?: boolean;
}) {
  const toneClass: Record<
    CalendarDayValueTone,
    { wrap: string; label: string; amount: string; prefix: string }
  > = {
    payable: {
      wrap: "border-destructive/40 bg-destructive/12 shadow-[inset_4px_0_0_0] shadow-destructive dark:bg-destructive/15",
      label: "text-destructive/95",
      amount: "text-destructive",
      prefix: "−",
    },
    pendingReceipt: {
      wrap: "border-amber-500/45 bg-amber-500/14 shadow-[inset_4px_0_0_0] shadow-amber-600 dark:bg-amber-500/15",
      label: "text-amber-900 dark:text-amber-200",
      amount: "text-amber-800 dark:text-amber-300",
      prefix: "−",
    },
    receivable: {
      wrap: "border-emerald-600/35 bg-emerald-500/12 shadow-[inset_4px_0_0_0] shadow-emerald-600 dark:bg-emerald-500/15",
      label: "text-emerald-800 dark:text-emerald-300",
      amount: "text-emerald-700 dark:text-emerald-400",
      prefix: "+",
    },
  };

  const styles = toneClass[tone];

  return (
    <div
      className={cn(
        "w-full min-w-0 overflow-hidden rounded-md border px-2 py-1.5 sm:py-2",
        styles.wrap,
        muted && "opacity-85",
      )}
      title={title}
    >
      <p
        className={cn(
          "text-[9px] font-bold uppercase leading-tight tracking-wide sm:text-[10px]",
          styles.label,
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-right text-sm font-extrabold tabular-nums leading-none sm:text-base",
          styles.amount,
        )}
      >
        {styles.prefix} {formatCurrency(amount)}
      </p>
    </div>
  );
}

export function BoletosCalendar({
  month,
  year,
  boletos,
  loading,
  onDayListOpen,
  formatCurrency,
  viewMode = "all",
  isPayableReadyToPay,
  onlyScheduledPayables,
}: BoletosCalendarProps) {
  const visibleBoletos = filterBoletosForView(boletos, viewMode);
  const byDay = groupByDueDate(visibleBoletos);
  const cells = buildCalendarCells(year, month);
  const splitPayableTotals = Boolean(isPayableReadyToPay);

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
                const prev = i > 0 ? cells[i - 1] : null;
                const monthChanged =
                  prev != null &&
                  (prev.month !== cell.month || prev.year !== cell.year);
                const entersCurrentMonth = monthChanged && cell.inCurrentMonth;
                const leavesCurrentMonth =
                  monthChanged && prev?.inCurrentMonth && !cell.inCurrentMonth;

                const dateStr = dateKey(cell.year, cell.month, cell.day);
                const list = byDay.get(dateStr) ?? [];
                const { payable, receivable, payableReady, payablePendingReceipt } =
                  dayTotals(list, {
                    splitPayableByReceipt: isPayableReadyToPay,
                    onlyScheduledPayables,
                  });
                const today = isToday(cell.year, cell.month, cell.day);
                const isWeekend = (() => {
                  return false;
                })();
                const isAdjacent = !cell.inCurrentMonth;
                const showMonthLabel =
                  cell.day === 1 || monthChanged || (i === 0 && isAdjacent);

                const dayListPayload: CalendarDayListPayload = {
                  dateKey: dateStr,
                  title: formatDayHeading(cell.year, cell.month, cell.day),
                  items: list,
                };

                const hasAny = list.length > 0;
                const showSplitPayables =
                  splitPayableTotals &&
                  (viewMode === "all" || viewMode === "payable") &&
                  payable > 0;

                return (
                  <div
                    key={`${dateStr}-${i}`}
                    role="presentation"
                    onClick={() => onDayListOpen(dayListPayload)}
                    className={cn(
                      "relative flex cursor-pointer flex-col overflow-hidden border-t border-l transition-colors hover:bg-muted/5",
                      splitPayableTotals
                        ? "min-h-[132px] sm:min-h-[156px]"
                        : "min-h-[112px] sm:min-h-[128px]",
                      !isAdjacent && "bg-background",
                      !isAdjacent &&
                        payablePendingReceipt > 0 &&
                        "bg-amber-500/[0.06] dark:bg-amber-500/[0.08]",
                      !isAdjacent &&
                        payablePendingReceipt === 0 &&
                        payableReady > 0 &&
                        "bg-destructive/[0.04] dark:bg-destructive/[0.06]",
                      !isAdjacent && isWeekend && "bg-muted/20",
                      isAdjacent &&
                        "border-dashed border-border/80 bg-muted/45 bg-[repeating-linear-gradient(-45deg,transparent,transparent_6px,hsl(var(--muted)/0.35)_6px,hsl(var(--muted)/0.35)_7px)]",
                      entersCurrentMonth &&
                        "border-l-[4px] border-l-primary shadow-[inset_4px_0_0_0] shadow-primary/15",
                      leavesCurrentMonth &&
                        "border-l-[4px] border-l-muted-foreground/50 border-dashed",
                      today &&
                        cell.inCurrentMonth &&
                        "ring-2 ring-primary/50 ring-inset sm:ring-[3px]",
                    )}
                  >
                    {isAdjacent && (
                      <div
                        className="pointer-events-none absolute inset-0 z-0 bg-background/25"
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
                          "mb-1 flex shrink-0 flex-col gap-0.5",
                          today && cell.inCurrentMonth && "text-primary",
                        )}
                      >
                        {showMonthLabel && (
                          <span
                            className={cn(
                              "text-[10px] font-semibold uppercase leading-none tracking-wide sm:text-[11px]",
                              isAdjacent
                                ? "text-muted-foreground/80"
                                : "text-muted-foreground",
                            )}
                          >
                            {monthShortLabel(cell.month, cell.year)}
                          </span>
                        )}
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className={cn(
                              "tabular-nums leading-none",
                              cell.inCurrentMonth
                                ? "text-xl font-bold sm:text-2xl"
                                : "text-base font-semibold text-muted-foreground sm:text-lg",
                              today && cell.inCurrentMonth && "text-primary",
                            )}
                          >
                            {cell.day}
                          </span>
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
                            <div
                              className={cn(
                                "flex w-full flex-col",
                                showSplitPayables ? "gap-1.5" : "gap-1",
                              )}
                            >
                              {receivable > 0 &&
                                (viewMode === "all" ||
                                  viewMode === "receivable") && (
                                  <CalendarDayValueBucket
                                    label="Vendas realizadas"
                                    amount={receivable}
                                    tone="receivable"
                                    formatCurrency={formatCurrency}
                                    title="Contas a receber"
                                    muted={isAdjacent}
                                  />
                                )}
                              {payable > 0 &&
                                (viewMode === "all" ||
                                  viewMode === "payable") &&
                                (showSplitPayables ? (
                                  <>
                                    {payableReady > 0 && (
                                      <CalendarDayValueBucket
                                        label="A pagar"
                                        amount={payableReady}
                                        tone="payable"
                                        formatCurrency={formatCurrency}
                                        title="Contas agendadas com recebimento confirmado ou sem vínculo com NF/romaneio"
                                        muted={isAdjacent}
                                      />
                                    )}
                                    {payablePendingReceipt > 0 && (
                                      <CalendarDayValueBucket
                                        label="A confirmar"
                                        amount={payablePendingReceipt}
                                        tone="pendingReceipt"
                                        formatCurrency={formatCurrency}
                                        title="NF ou romaneio aguardando recebimento da mercadoria"
                                        muted={isAdjacent}
                                      />
                                    )}
                                  </>
                                ) : (
                                  <CalendarDayValueBucket
                                    label="Valores a pagar"
                                    amount={payable}
                                    tone="payable"
                                    formatCurrency={formatCurrency}
                                    title="Contas a pagar"
                                    muted={isAdjacent}
                                  />
                                ))}
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

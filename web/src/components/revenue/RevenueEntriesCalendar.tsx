import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { buildCalendarCells } from "@/lib/boletosCalendarGrid";
import { cn } from "@/lib/utils";
import type { RevenueEntry } from "@/types/revenue";
import {
  serviceDailySaleDisplayAmount,
  type ServiceDailySaleCalendarRow,
} from "@/types/serviceDailySale";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function groupByEntryDate(entries: RevenueEntry[]): Map<string, RevenueEntry[]> {
  const m = new Map<string, RevenueEntry[]>();
  for (const e of entries) {
    const key = e.entry_date.slice(0, 10);
    const arr = m.get(key) ?? [];
    arr.push(e);
    m.set(key, arr);
  }
  for (const [, arr] of m) {
    arr.sort((a, b) => Number(b.net_amount) - Number(a.net_amount));
  }
  return m;
}

function groupServicesByDate(
  sales: ServiceDailySaleCalendarRow[],
): Map<string, ServiceDailySaleCalendarRow[]> {
  const m = new Map<string, ServiceDailySaleCalendarRow[]>();
  for (const s of sales) {
    const key = s.sale_date.slice(0, 10);
    const arr = m.get(key) ?? [];
    arr.push(s);
    m.set(key, arr);
  }
  for (const [, arr] of m) {
    arr.sort(
      (a, b) =>
        serviceDailySaleDisplayAmount(b) - serviceDailySaleDisplayAmount(a),
    );
  }
  return m;
}

function dayNetTotal(items: RevenueEntry[]): number {
  return items.reduce((s, e) => s + Number(e.net_amount), 0);
}

function dayServicesTotal(items: ServiceDailySaleCalendarRow[]): number {
  return items.reduce((s, e) => s + serviceDailySaleDisplayAmount(e), 0);
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

export type RevenueCalendarDayListPayload = {
  /** YYYY-MM-DD */
  dateKey: string;
  title: string;
  items: RevenueEntry[];
  serviceItems: ServiceDailySaleCalendarRow[];
};

interface RevenueEntriesCalendarProps {
  month: number;
  year: number;
  entries: RevenueEntry[];
  /** Vendas diárias de serviços (EPOC), opcional. */
  serviceSales?: ServiceDailySaleCalendarRow[];
  loading: boolean;
  onDayListOpen: (payload: RevenueCalendarDayListPayload) => void;
  formatCurrency: (v: number) => string;
}

function DayValueBucket({
  label,
  amount,
  tone,
  formatCurrency,
  muted,
}: {
  label: string;
  amount: number;
  tone: "product" | "service";
  formatCurrency: (v: number) => string;
  muted?: boolean;
}) {
  const styles =
    tone === "product"
      ? {
          wrap: "border-emerald-600/25 bg-emerald-500/[0.07] shadow-[inset_3px_0_0_0] shadow-emerald-600/75 dark:bg-emerald-500/10 dark:shadow-emerald-500/70",
          label: "text-emerald-700 dark:text-emerald-400/95",
          amount: "text-emerald-600 dark:text-emerald-400",
        }
      : {
          wrap: "border-sky-600/30 bg-sky-500/[0.08] shadow-[inset_3px_0_0_0] shadow-sky-600/70 dark:bg-sky-500/12 dark:shadow-sky-500/65",
          label: "text-sky-800 dark:text-sky-300",
          amount: "text-sky-700 dark:text-sky-400",
        };

  return (
    <div
      className={cn(
        "flex w-full min-w-0 overflow-hidden rounded-md border",
        styles.wrap,
        muted && "opacity-85",
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 px-1.5 py-1 sm:items-center sm:justify-between sm:gap-1">
        <span
          className={cn(
            "text-left text-[6px] font-semibold uppercase leading-tight tracking-wide sm:text-[10px]",
            styles.label,
          )}
        >
          {label}
        </span>
        <p
          className={cn(
            "text-right text-[9px] font-semibold tabular-nums leading-none sm:text-[12px]",
            styles.amount,
          )}
        >
          + {formatCurrency(amount)}
        </p>
      </div>
    </div>
  );
}

export function RevenueEntriesCalendar({
  month,
  year,
  entries,
  serviceSales = [],
  loading,
  onDayListOpen,
  formatCurrency,
}: RevenueEntriesCalendarProps) {
  const byDay = groupByEntryDate(entries);
  const servicesByDay = groupServicesByDate(serviceSales);
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
      <div className="space-y-3">
        {serviceSales.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-sm bg-emerald-500"
                aria-hidden
              />
              Produtos
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-sm bg-sky-500"
                aria-hidden
              />
              Serviços
            </span>
          </div>
        )}
        <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
          <div className="min-w-[640px]">
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
                const serviceList = servicesByDay.get(dateStr) ?? [];
                const productsTotal = dayNetTotal(list);
                const servicesTotal = dayServicesTotal(serviceList);
                const today = isToday(cell.year, cell.month, cell.day);
                const isAdjacent = !cell.inCurrentMonth;
                const showMonthLabel =
                  cell.day === 1 || monthChanged || (i === 0 && isAdjacent);

                const dayListPayload: RevenueCalendarDayListPayload = {
                  dateKey: dateStr,
                  title: formatDayHeading(cell.year, cell.month, cell.day),
                  items: list,
                  serviceItems: serviceList,
                };

                const hasProducts = list.length > 0;
                const hasServices = serviceList.length > 0;
                const hasAny = hasProducts || hasServices;
                const itemCount = list.length + serviceList.length;

                return (
                  <div
                    key={`${dateStr}-${i}`}
                    role="presentation"
                    onClick={() => onDayListOpen(dayListPayload)}
                    className={cn(
                      "relative flex min-h-[112px] cursor-pointer flex-col overflow-hidden border-t border-l transition-colors hover:bg-muted/5 sm:min-h-[128px]",
                      !isAdjacent && "bg-background",
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
                                  {itemCount}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                className="max-w-[220px]"
                              >
                                {hasProducts && hasServices
                                  ? `${list.length} produto(s), ${serviceList.length} serviço(s)`
                                  : hasServices
                                    ? "Serviços neste dia"
                                    : "Vendas de produtos neste dia"}
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
                            {hasProducts && (
                              <DayValueBucket
                                label="Produtos"
                                amount={productsTotal}
                                tone="product"
                                formatCurrency={formatCurrency}
                                muted={isAdjacent}
                              />
                            )}
                            {hasServices && (
                              <DayValueBucket
                                label="Serviços"
                                amount={servicesTotal}
                                tone="service"
                                formatCurrency={formatCurrency}
                                muted={isAdjacent}
                              />
                            )}
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

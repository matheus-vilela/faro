import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  CashFlowBucketItem,
  PeriodBucket,
} from "@/lib/cashFlowSimulation/types";
import { addDaysYmd } from "@/lib/payableTotals";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";

function formatShortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function formatWeekdayLong(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "short",
  });
}

function formatWeekdayShort(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString("pt-BR", {
    weekday: "short",
  });
  return label.replace(/\.$/, "");
}

function itemTitle(item: CashFlowBucketItem): string {
  const counterparty = item.counterpartyLabel?.trim();
  if (counterparty) return counterparty;
  const raw = item.description?.trim();
  if (raw) return raw;
  return item.direction === "inflow" ? "Recebimento" : "Pagamento";
}

/** NF / descrição sob o fornecedor (só quando o título é a contraparte). */
function itemSubtitle(item: CashFlowBucketItem): string | null {
  const counterparty = item.counterpartyLabel?.trim();
  const desc = item.description?.trim();
  if (!counterparty || !desc) return null;
  if (
    desc.toLocaleLowerCase("pt-BR") === counterparty.toLocaleLowerCase("pt-BR")
  ) {
    return null;
  }
  return desc;
}

type DayRow = {
  ymd: string;
  inflows: number;
  outflows: number;
  runningBalance: number;
  items: CashFlowBucketItem[];
};

/** Agrupa itens da semana em 7 dias; datas fora do intervalo (ex.: clamp) vão no último dia. */
function buildWeekDayRows(
  bucket: PeriodBucket,
  weekOpeningBalance: number,
): DayRow[] {
  const days: DayRow[] = [];
  for (let i = 0; i < 7; i++) {
    const ymd = addDaysYmd(bucket.startYmd, i);
    if (ymd > bucket.endYmd) break;
    days.push({
      ymd,
      inflows: 0,
      outflows: 0,
      runningBalance: weekOpeningBalance,
      items: [],
    });
  }
  if (!days.length) return days;

  const byYmd = new Map(days.map((d) => [d.ymd, d]));
  const last = days[days.length - 1]!;

  for (const item of bucket.items) {
    const amount = Number(item.amount) || 0;
    if (amount <= 0) continue;

    let day = byYmd.get(item.simulatedDateYmd);
    if (!day) {
      if (
        item.simulatedDateYmd < bucket.startYmd ||
        item.simulatedDateYmd > bucket.endYmd
      ) {
        day = last;
      } else {
        continue;
      }
    }

    day.items.push(item);
    if (item.direction === "inflow") day.inflows += amount;
    else day.outflows += amount;
  }

  let running = weekOpeningBalance;
  for (const day of days) {
    running += day.inflows - day.outflows;
    day.runningBalance = running;
    day.items.sort((a, b) => {
      const byDir =
        a.direction === b.direction ? 0 : a.direction === "inflow" ? -1 : 1;
      if (byDir !== 0) return byDir;
      return b.amount - a.amount;
    });
  }

  return days;
}

function ItemRow({
  item,
  formatCurrency,
}: {
  item: CashFlowBucketItem;
  formatCurrency: (v: number) => string;
}) {
  const isInflow = item.direction === "inflow";
  const subtitle = itemSubtitle(item);
  return (
    <li className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {itemTitle(item)}
        </p>
        {subtitle ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {subtitle}
          </p>
        ) : null}
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>Venc. {formatShortDate(item.dueDateYmd)}</span>
          {item.simulatedDateYmd !== item.dueDateYmd ? (
            <span>→ simulado {formatShortDate(item.simulatedDateYmd)}</span>
          ) : null}
          {item.isSettled ? (
            <Badge variant="outline" className="h-5">
              Liquidado
            </Badge>
          ) : null}
          {item.isOverdue ? (
            <Badge
              variant="outline"
              className="h-5 border-red-500/40 text-red-600"
            >
              Vencida
            </Badge>
          ) : null}
          {item.isProjected ? (
            <Badge variant="outline" className="h-5">
              Projetada
            </Badge>
          ) : null}
          {item.clampedToHorizon ? (
            <Badge
              variant="outline"
              className="h-5 border-amber-500/40 text-amber-700"
            >
              Além do horizonte
            </Badge>
          ) : null}
        </div>
      </div>
      <p
        className={cn(
          "shrink-0 text-sm font-semibold tabular-nums",
          isInflow
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-red-600 dark:text-red-400",
        )}
      >
        {isInflow ? "+" : "−"}
        {formatCurrency(item.amount)}
      </p>
    </li>
  );
}

function WeekDaysTable({
  bucket,
  formatCurrency,
  onOpenDay,
}: {
  bucket: PeriodBucket;
  formatCurrency: (v: number) => string;
  onOpenDay: (day: DayRow) => void;
}) {
  const days = useMemo(() => {
    // Saldo ao fim da semana − líquido da semana = saldo no início da semana.
    const weekOpening = bucket.runningBalance - bucket.netFlow;
    return buildWeekDayRows(bucket, weekOpening);
  }, [bucket]);

  return (
    <>
      {days.map((day) => {
        const net = day.inflows - day.outflows;
        const hasMovement = day.items.length > 0;
        const negativeBalance = day.runningBalance < 0;
        return (
          <tr
            key={day.ymd}
            className={cn(
              "border-b border-border/40 last:border-0",
              hasMovement && "hover:bg-muted/50",
            )}
            onClick={() => hasMovement && onOpenDay(day)}
          >
            <td className="px-3 py-2 pl-12">
              <button
                type="button"
                disabled={!hasMovement}
                className={cn(
                  "text-left ",
                  hasMovement
                    ? "text-foreground underline-offset-2 hover:underline"
                    : "cursor-default text-muted-foreground",
                )}
              >
                <span className="font-medium capitalize">
                  {formatWeekdayShort(day.ymd)}
                </span>
                <span className="ml-1.5 text-muted-foreground">
                  {formatShortDate(day.ymd)}
                </span>
              </button>
            </td>
            <td
              className={cn(
                "px-3 py-2 text-right tabular-nums",
                day.inflows > 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground",
              )}
            >
              {day.inflows > 0 ? formatCurrency(day.inflows) : "—"}
            </td>
            <td
              className={cn(
                "px-3 py-2 text-right tabular-nums",
                day.outflows > 0
                  ? "text-red-600 dark:text-red-400"
                  : "text-muted-foreground",
              )}
            >
              {day.outflows > 0 ? formatCurrency(day.outflows) : "—"}
            </td>
            <td
              className={cn(
                "px-3 py-2 text-right tabular-nums",
                !hasMovement
                  ? "text-muted-foreground"
                  : net >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400",
              )}
            >
              {hasMovement ? formatCurrency(net) : "—"}
            </td>
            <td
              className={cn(
                "px-3 py-2 text-right font-semibold tabular-nums",
                negativeBalance
                  ? "text-red-600 dark:text-red-400"
                  : "text-foreground",
              )}
            >
              {formatCurrency(day.runningBalance)}
            </td>
          </tr>
        );
      })}
    </>
  );
}

type DayDetailTab = "inflow" | "outflow";

function DayDetailSheet({
  day,
  weekLabel,
  formatCurrency,
  open,
  onOpenChange,
}: {
  day: DayRow | null;
  weekLabel: string;
  formatCurrency: (v: number) => string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [tab, setTab] = useState<DayDetailTab>("inflow");

  const inflows = useMemo(
    () => (day ? day.items.filter((i) => i.direction === "inflow") : []),
    [day],
  );
  const outflows = useMemo(
    () => (day ? day.items.filter((i) => i.direction === "outflow") : []),
    [day],
  );

  useEffect(() => {
    if (!day || !open) return;
    setTab(day.inflows > 0 || day.outflows === 0 ? "inflow" : "outflow");
  }, [day, open]);

  const activeItems = tab === "inflow" ? inflows : outflows;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="z-[60] flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        {day ? (
          <>
            <SheetHeader className="shrink-0 space-y-1 border-b px-6 py-4 pr-12 text-left">
              <SheetTitle className="pr-2 capitalize leading-snug">
                {formatWeekdayLong(day.ymd)}
              </SheetTitle>
              <SheetDescription>
                {weekLabel} ·<br />
                entrou{" "}
                <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(day.inflows)}
                </span>
                <br />
                saiu{" "}
                <span className="font-semibold tabular-nums text-red-600 dark:text-red-400">
                  {formatCurrency(day.outflows)}
                </span>
              </SheetDescription>
            </SheetHeader>

            <div className="flex shrink-0 gap-2 border-b px-6 py-3">
              <Button
                type="button"
                size="sm"
                variant={tab === "inflow" ? "default" : "outline"}
                onClick={() => setTab("inflow")}
              >
                Entradas
                {inflows.length > 0 ? (
                  <span className="ml-1.5 tabular-nums opacity-80">
                    ({inflows.length})
                  </span>
                ) : null}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={tab === "outflow" ? "default" : "outline"}
                onClick={() => setTab("outflow")}
              >
                Saídas
                {outflows.length > 0 ? (
                  <span className="ml-1.5 tabular-nums opacity-80">
                    ({outflows.length})
                  </span>
                ) : null}
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {activeItems.length === 0 ? (
                <p className="px-6 py-8 text-sm text-muted-foreground">
                  {tab === "inflow"
                    ? "Nenhuma entrada neste dia."
                    : "Nenhuma saída neste dia."}
                </p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {activeItems.map((item) => (
                    <ItemRow
                      key={`${item.id}-${item.simulatedDateYmd}-${item.direction}`}
                      item={item}
                      formatCurrency={formatCurrency}
                    />
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export function CashFlowPeriodTable({
  buckets,
  loading,
  formatCurrency,
}: {
  buckets: PeriodBucket[];
  loading: boolean;
  formatCurrency: (v: number) => string;
}) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [detailDay, setDetailDay] = useState<{
    day: DayRow;
    weekLabel: string;
  } | null>(null);

  return (
    <>
      <Card className="border-border/80 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Detalhamento por semana</CardTitle>
          <CardDescription>
            Expanda uma semana para ver o movimento dia a dia. Clique em um dia
            para detalhar entradas e saídas. Semana 1 é a semana contábil atual
            do estabelecimento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : buckets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma movimentação prevista no horizonte selecionado.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 text-left">Semana</th>
                    <th className="px-3 py-2 text-right">Entradas</th>
                    <th className="px-3 py-2 text-right">Saídas</th>
                    <th className="px-3 py-2 text-right">Líquido</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.map((bucket) => {
                    const negative = bucket.runningBalance < 0;
                    const hasItems = bucket.items.length > 0;
                    const expanded = expandedIndex === bucket.index;

                    return (
                      <Fragment key={bucket.index}>
                        <tr
                          className={cn(
                            "border-b border-border/60",
                            negative && "bg-red-500/5",
                          )}
                        >
                          <td className="px-3 py-3">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-auto w-full justify-start gap-2 px-0 hover:bg-transparent"
                              disabled={!hasItems}
                              onClick={() =>
                                setExpandedIndex((prev) =>
                                  prev === bucket.index ? null : bucket.index,
                                )
                              }
                            >
                              <ChevronDown
                                className={cn(
                                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                                  expanded && "rotate-180",
                                  !hasItems && "opacity-30",
                                )}
                              />
                              <div className="text-left">
                                <div className="font-medium text-foreground">
                                  Sem {bucket.index + 1}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {bucket.label}
                                </div>
                              </div>
                            </Button>
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(bucket.inflows)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-red-600 dark:text-red-400">
                            {formatCurrency(bucket.outflows)}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-3 text-right tabular-nums",
                              bucket.netFlow >= 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-red-600 dark:text-red-400",
                            )}
                          >
                            {formatCurrency(bucket.netFlow)}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-3 text-right font-semibold tabular-nums",
                              negative
                                ? "text-red-600 dark:text-red-400"
                                : "text-foreground",
                            )}
                          >
                            {formatCurrency(bucket.runningBalance)}
                          </td>
                        </tr>
                        {expanded && hasItems ? (
                          <WeekDaysTable
                            bucket={bucket}
                            formatCurrency={formatCurrency}
                            onOpenDay={(day) =>
                              setDetailDay({
                                day,
                                weekLabel: `Sem ${bucket.index + 1} · ${bucket.label}`,
                              })
                            }
                          />
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <DayDetailSheet
        day={detailDay?.day ?? null}
        weekLabel={detailDay?.weekLabel ?? ""}
        formatCurrency={formatCurrency}
        open={!!detailDay}
        onOpenChange={(open) => {
          if (!open) setDetailDay(null);
        }}
      />
    </>
  );
}

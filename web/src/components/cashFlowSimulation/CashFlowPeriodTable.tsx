import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { PeriodBucket } from "@/lib/cashFlowSimulation/types";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import { Fragment, useState } from "react";

function formatShortDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function BucketItemsList({
  bucket,
  formatCurrency,
}: {
  bucket: PeriodBucket;
  formatCurrency: (v: number) => string;
}) {
  if (!bucket.items.length) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        Nenhuma movimentação nesta semana.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border/60 border-t border-border/60 bg-muted/20">
      {bucket.items.map((item) => {
        const isInflow = item.direction === "inflow";
        return (
          <li
            key={`${item.id}-${item.simulatedDateYmd}-${item.direction}`}
            className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {item.description?.trim() || (isInflow ? "Recebimento" : "Pagamento")}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span>Venc. {formatShortDate(item.dueDateYmd)}</span>
                {item.simulatedDateYmd !== item.dueDateYmd ? (
                  <span>→ simulado {formatShortDate(item.simulatedDateYmd)}</span>
                ) : null}
                {item.isOverdue ? (
                  <Badge variant="outline" className="h-5 border-red-500/40 text-red-600">
                    Vencida
                  </Badge>
                ) : null}
                {item.isProjected ? (
                  <Badge variant="outline" className="h-5">
                    Projetada
                  </Badge>
                ) : null}
                {item.clampedToHorizon ? (
                  <Badge variant="outline" className="h-5 border-amber-500/40 text-amber-700">
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
      })}
    </ul>
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

  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Detalhamento por semana</CardTitle>
        <CardDescription>
          Clique em uma semana para ver as contas que compõem entradas e saídas.
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
                                {hasItems ? (
                                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                                    {bucket.items.length}{" "}
                                    {bucket.items.length === 1 ? "item" : "itens"}
                                  </span>
                                ) : null}
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
                        <tr className="border-b border-border/60 last:border-0">
                          <td colSpan={5} className="p-0">
                            <BucketItemsList
                              bucket={bucket}
                              formatCurrency={formatCurrency}
                            />
                          </td>
                        </tr>
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
  );
}

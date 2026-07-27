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

export function CashFlowPeriodTable({
  buckets,
  loading,
  formatCurrency,
}: {
  buckets: PeriodBucket[];
  loading: boolean;
  formatCurrency: (v: number) => string;
}) {
  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Detalhamento por semana</CardTitle>
        <CardDescription>
          Entradas, saídas e saldo acumulado em cada semana do horizonte.
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
                  return (
                    <tr
                      key={bucket.index}
                      className={cn(
                        "border-b border-border/60 last:border-0",
                        negative && "bg-red-500/5",
                      )}
                    >
                      <td className="px-3 py-3">
                        <div className="font-medium text-foreground">
                          Sem {bucket.index + 1}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {bucket.label}
                        </div>
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

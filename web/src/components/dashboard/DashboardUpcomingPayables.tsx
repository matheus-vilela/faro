import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBrl } from "@/lib/dre/formatBrl";
import { addDaysYmd } from "@/lib/payableTotals";
import { localDateYmd } from "@/lib/boletoPayment";
import { cn } from "@/lib/utils";
import type { UpcomingPayableRow } from "@/hooks/useDashboardHomeData";
import { Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

function formatDueLabel(ymd: string, todayYmd: string): string {
  if (ymd === todayYmd) return "Hoje";
  if (ymd === addDaysYmd(todayYmd, 1)) return "Amanhã";
  const [, m, d] = ymd.split("-");
  return `${d}/${m}`;
}

function dueTone(ymd: string, todayYmd: string): string {
  if (ymd <= todayYmd) return "font-semibold text-destructive";
  if (ymd <= addDaysYmd(todayYmd, 2)) {
    return "font-semibold text-amber-700 dark:text-amber-400";
  }
  return "font-semibold text-muted-foreground";
}

export function DashboardUpcomingPayables({
  rows,
  loading,
}: {
  rows: UpcomingPayableRow[];
  loading: boolean;
}) {
  const today = localDateYmd();

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold sm:text-lg">
          Próximos vencimentos
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma conta a vencer nos próximos 7 dias.
          </p>
        ) : (
          <ul className="flex flex-col">
            {rows.map((row, i) => (
              <li
                key={row.id}
                className={cn(
                  "flex items-center justify-between gap-3 py-2.5",
                  i < rows.length - 1 && "border-b border-border/60",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {row.description?.trim() || "Conta a pagar"}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">
                  {formatBrl(row.amount)}
                </span>
                <span
                  className={cn(
                    "w-14 shrink-0 text-right text-xs tabular-nums",
                    dueTone(row.due_date, today),
                  )}
                >
                  {formatDueLabel(row.due_date, today)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" size="sm" className="mt-4 w-full" asChild>
          <Link to="/app/contas-a-pagar">Ver contas a pagar</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

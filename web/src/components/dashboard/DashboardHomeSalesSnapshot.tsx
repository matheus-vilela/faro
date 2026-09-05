import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBrl } from "@/lib/dre/formatBrl";
import {
  formatCompactBrl,
  type ResumoDashboard,
} from "@/lib/vendasRealizadasResumo";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

const BAR_COLORS = [
  "bg-emerald-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-cyan-500",
  "bg-amber-500",
  "bg-primary",
];

export function DashboardHomeSalesSnapshot({
  sales,
  loading,
  periodWord,
}: {
  sales: ResumoDashboard | null;
  loading: boolean;
  periodWord: string;
}) {
  const champions = (sales?.champions ?? []).slice(0, 5);
  const payments = (sales?.payments ?? []).filter((p) => p.includeInNetSales);
  const maxAmount = champions.reduce((m, c) => Math.max(m, c.revenue), 0);

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle className="text-base font-semibold sm:text-lg">
            Vendas por produto · {periodWord}
          </CardTitle>
          <div className="flex flex-wrap gap-1.5">
            {payments.slice(0, 4).map((p) => (
              <span
                key={p.key}
                className="rounded-full border border-border/80 bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground"
              >
                {p.shortLabel}{" "}
                {(p.share * 100).toLocaleString("pt-BR", {
                  maximumFractionDigits: 0,
                })}
                %
              </span>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando vendas…
          </div>
        ) : champions.length === 0 ? (
          <div className="space-y-1 py-8 text-center text-sm text-muted-foreground">
            <p>Nenhuma venda neste período.</p>
            <p className="text-xs">
              Sincronize o PDV ou confira{" "}
              <Link
                to="/app/vendas-realizadas"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                Vendas realizadas
              </Link>
              .
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {champions.map((row, i) => {
              const pct =
                maxAmount > 0
                  ? Math.min(100, (row.revenue / maxAmount) * 100)
                  : 0;
              return (
                <li key={row.key} className="space-y-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 text-sm leading-snug break-words text-foreground">
                      {row.label}
                    </span>
                    <span className="shrink-0 text-right text-sm font-semibold tabular-nums">
                      {row.revenue >= 1000
                        ? `R$ ${formatCompactBrl(row.revenue)}`
                        : formatBrl(row.revenue)}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-500",
                        BAR_COLORS[i % BAR_COLORS.length],
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

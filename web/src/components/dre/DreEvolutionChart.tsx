import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DreHistoryPoint } from "@/lib/dre/fetchDreHistory";
import { formatBrl } from "@/lib/dre/formatBrl";
import { cn } from "@/lib/utils";

export function DreEvolutionChart({
  points,
  projection,
  loading,
}: {
  points: DreHistoryPoint[];
  projection: { projected: number; daysLeft: number } | null;
  loading?: boolean;
}) {
  if (loading) {
    return <Skeleton className="h-[280px] w-full rounded-xl" />;
  }

  const values = points.map((p) => p.computed.lucroLiquido);
  if (projection) values.push(projection.projected);
  const maxAbs = Math.max(...values.map((v) => Math.abs(v)), 1);

  return (
    <Card className="border-border/80 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle className="text-base">Evolução do resultado</CardTitle>
          <div className="flex gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3.5 rounded bg-emerald-500" />
              Realizado
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-3.5 rounded bg-primary" />
              Projetado
            </span>
          </div>
        </div>
        <CardDescription>
          Lucro líquido dos últimos meses
          {projection
            ? ` · projeção fim do mês (faltam ${projection.daysLeft} dia(s))`
            : ""}
          .
        </CardDescription>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <div className="flex h-[180px] items-center justify-center text-sm text-muted-foreground">
            Sem histórico suficiente.
          </div>
        ) : (
          <div className="flex h-[180px] items-end gap-2 sm:h-[200px] sm:gap-3">
            {points.map((p, i) => {
              const v = p.computed.lucroLiquido;
              const h = Math.max(4, (Math.abs(v) / maxAbs) * 100);
              const isLast = i === points.length - 1;
              return (
                <div
                  key={`${p.period.year}-${p.period.month}`}
                  className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
                >
                  <span
                    className={cn(
                      "text-[10px] tabular-nums sm:text-[11px]",
                      isLast
                        ? "font-bold text-primary"
                        : "text-muted-foreground",
                    )}
                  >
                    {formatBrl(v).replace(/\s/g, "\u00a0")}
                  </span>
                  <span
                    className={cn(
                      "w-[70%] min-h-1 rounded-t-md",
                      v < 0
                        ? "bg-rose-500/70"
                        : isLast
                          ? "bg-primary"
                          : "bg-muted-foreground/35",
                    )}
                    style={{ height: `${h}%` }}
                  />
                  <span
                    className={cn(
                      "w-full border-t border-border/60 pt-1.5 text-center text-[11px]",
                      isLast
                        ? "font-semibold text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {p.label}
                  </span>
                </div>
              );
            })}
            {projection ? (
              <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5 opacity-70">
                <span className="text-[10px] font-semibold tabular-nums text-primary sm:text-[11px]">
                  {formatBrl(projection.projected)}
                </span>
                <span
                  className="w-[70%] min-h-1 rounded-t-md bg-[repeating-linear-gradient(45deg,var(--primary),var(--primary)_4px,transparent_4px,transparent_8px)]"
                  style={{
                    height: `${Math.max(4, (Math.abs(projection.projected) / maxAbs) * 100)}%`,
                  }}
                />
                <span className="w-full border-t border-border/60 pt-1.5 text-center text-[11px] text-muted-foreground">
                  proj
                </span>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

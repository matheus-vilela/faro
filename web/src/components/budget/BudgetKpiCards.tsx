import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  BudgetComparisonSummary,
  BudgetDeviationStatus,
} from "@/lib/budget/types";
import { formatBrl } from "@/lib/dre/formatBrl";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "danger" | "success" | "warning";

function toneFromStatus(status: BudgetDeviationStatus): Tone {
  if (status === "over" || status === "no_budget") return "danger";
  if (status === "warning") return "warning";
  if (status === "ok") return "success";
  return "neutral";
}

function KpiCard({
  label,
  amount,
  subtitle,
  tone,
  loading,
}: {
  label: string;
  amount: string;
  subtitle?: string;
  tone: Tone;
  loading: boolean;
}) {
  const valueClass =
    tone === "danger"
      ? "text-red-600 dark:text-red-400"
      : tone === "success"
        ? "text-emerald-600 dark:text-emerald-400"
        : tone === "warning"
          ? "text-amber-600 dark:text-amber-400"
          : "text-foreground";

  return (
    <Card className="border-border/80 py-4 shadow-sm">
      <CardContent className="flex flex-col gap-1.5 px-4 sm:px-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        {loading ? (
          <>
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-4 w-20" />
          </>
        ) : (
          <>
            <p
              className={cn(
                "text-2xl font-bold tabular-nums tracking-tight",
                valueClass,
              )}
            >
              {amount}
            </p>
            {subtitle ? (
              <p className={cn("text-sm", valueClass)}>{subtitle}</p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function BudgetKpiCards({
  summary,
  loading,
}: {
  summary: BudgetComparisonSummary | null;
  loading: boolean;
}) {
  const statusTone = summary
    ? toneFromStatus(summary.aggregateStatus)
    : "neutral";

  const varianceTone =
    summary && summary.totalVariance > 0
      ? "danger"
      : summary && summary.totalVariance < 0
        ? "success"
        : "neutral";

  const percentLabel =
    summary?.percentConsumed != null
      ? `${summary.percentConsumed.toLocaleString("pt-BR", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 1,
        })}%`
      : "—";

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label="Orçado"
        amount={summary ? formatBrl(summary.totalBudgeted) : formatBrl(0)}
        tone="neutral"
        loading={loading}
      />
      <KpiCard
        label="Realizado"
        amount={summary ? formatBrl(summary.totalActual) : formatBrl(0)}
        tone="neutral"
        loading={loading}
      />
      <KpiCard
        label="Desvio"
        amount={
          summary
            ? `${summary.totalVariance >= 0 ? "+" : ""}${formatBrl(summary.totalVariance)}`
            : formatBrl(0)
        }
        subtitle={
          summary && summary.totalVariance > 0
            ? "Acima do orçado"
            : summary && summary.totalVariance < 0
              ? "Abaixo do orçado"
              : undefined
        }
        tone={varianceTone}
        loading={loading}
      />
      <KpiCard
        label="Consumido"
        amount={percentLabel}
        subtitle="Do total orçado"
        tone={statusTone}
        loading={loading}
      />
    </div>
  );
}

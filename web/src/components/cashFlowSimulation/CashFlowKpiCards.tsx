import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { CashFlowProjectionKpis } from "@/lib/cashFlowSimulation/types";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "danger" | "success" | "warning";

function KpiCard({
  label,
  amount,
  subtitle,
  tone,
  loading,
  formatCurrency,
}: {
  label: string;
  amount: number;
  subtitle?: string;
  tone: Tone;
  loading: boolean;
  formatCurrency: (v: number) => string;
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
              {formatCurrency(amount)}
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

export function CashFlowKpiCards({
  kpis,
  baseKpis,
  loading,
  formatCurrency,
}: {
  kpis: CashFlowProjectionKpis;
  baseKpis?: CashFlowProjectionKpis | null;
  loading: boolean;
  formatCurrency: (v: number) => string;
}) {
  const minTone: Tone = kpis.minBalance < 0 ? "danger" : "warning";
  const minSubtitle = minBalanceSubtitle(kpis.minBalance, baseKpis, formatCurrency);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label="Saldo inicial"
        amount={kpis.openingBalance}
        tone="neutral"
        loading={loading}
        formatCurrency={formatCurrency}
      />
      <KpiCard
        label="Entradas previstas"
        amount={kpis.totalInflows}
        tone="success"
        loading={loading}
        formatCurrency={formatCurrency}
      />
      <KpiCard
        label="Saídas previstas"
        amount={kpis.totalOutflows}
        tone="danger"
        loading={loading}
        formatCurrency={formatCurrency}
      />
      <KpiCard
        label="Saldo mínimo"
        amount={kpis.minBalance}
        subtitle={minSubtitle}
        tone={minTone}
        loading={loading}
        formatCurrency={formatCurrency}
      />
    </div>
  );
}

function minBalanceSubtitle(
  minBalance: number,
  baseKpis: CashFlowProjectionKpis | null | undefined,
  formatCurrency: (v: number) => string,
): string {
  if (baseKpis) {
    const delta = minBalance - baseKpis.minBalance;
    if (delta !== 0) {
      const vsBase =
        delta > 0
          ? `${formatCurrency(delta)} melhor que o Base`
          : `${formatCurrency(Math.abs(delta))} pior que o Base`;
      return vsBase;
    }
  }
  return minBalance < 0
    ? "Atenção: caixa negativo no período"
    : "Menor saldo previsto";
}

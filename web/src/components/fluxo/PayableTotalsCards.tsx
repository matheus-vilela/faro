import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatContasCount,
  type PayableTotals,
} from "@/lib/payableTotals";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "danger" | "success";

function TotalsCard({
  label,
  amount,
  subtitle,
  tone,
  loading,
  formatCurrency,
}: {
  label: string;
  amount: number;
  subtitle: string;
  tone: Tone;
  loading: boolean;
  formatCurrency: (v: number) => string;
}) {
  const valueClass =
    tone === "danger"
      ? "text-red-600 dark:text-red-400"
      : tone === "success"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-foreground";
  const subtitleClass =
    tone === "danger"
      ? "text-red-600 dark:text-red-400"
      : tone === "success"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-muted-foreground";

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
            <p className={cn("text-sm", subtitleClass)}>{subtitle}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function PayableTotalsCards({
  totals,
  loading,
  monthName,
  formatCurrency,
}: {
  totals: PayableTotals;
  loading: boolean;
  /** Mês em pt-BR minúsculo, ex.: "julho" */
  monthName: string;
  formatCurrency: (v: number) => string;
}) {
  const overdueSubtitle =
    totals.overdue.count > 0
      ? `${formatContasCount(totals.overdue.count)} — resolva hoje`
      : formatContasCount(0);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <TotalsCard
        label={`A pagar em ${monthName}`}
        amount={totals.toPayInMonth.amount}
        subtitle={formatContasCount(totals.toPayInMonth.count)}
        tone="neutral"
        loading={loading}
        formatCurrency={formatCurrency}
      />
      <TotalsCard
        label="Vence nos próximos 7 dias"
        amount={totals.dueInNext7Days.amount}
        subtitle={formatContasCount(totals.dueInNext7Days.count)}
        tone="neutral"
        loading={loading}
        formatCurrency={formatCurrency}
      />
      <TotalsCard
        label="Vencidas"
        amount={totals.overdue.amount}
        subtitle={overdueSubtitle}
        tone="danger"
        loading={loading}
        formatCurrency={formatCurrency}
      />
      <TotalsCard
        label="Pagas no mês"
        amount={totals.paidInMonth.amount}
        subtitle={formatContasCount(totals.paidInMonth.count)}
        tone="success"
        loading={loading}
        formatCurrency={formatCurrency}
      />
    </div>
  );
}

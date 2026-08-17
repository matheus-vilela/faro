import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatContasCount,
  type PayableTotals,
} from "@/lib/payableTotals";
import { cn } from "@/lib/utils";
import {
  BadgeCheck,
  CalendarClock,
  CircleAlert,
  Wallet,
  type LucideIcon,
} from "lucide-react";

type Tone = "neutral" | "danger" | "success" | "warning";

function TotalsCard({
  label,
  amount,
  subtitle,
  tone,
  icon: Icon,
  loading,
  formatCurrency,
}: {
  label: string;
  amount: number;
  subtitle: string;
  tone: Tone;
  icon: LucideIcon;
  loading: boolean;
  formatCurrency: (v: number) => string;
}) {
  const valueClass =
    tone === "danger"
      ? "text-red-600 dark:text-red-400"
      : tone === "success"
        ? "text-emerald-600 dark:text-emerald-400"
        : tone === "warning"
          ? "text-amber-700 dark:text-amber-400"
          : "text-foreground";
  const subtitleClass =
    tone === "danger"
      ? "text-red-600 dark:text-red-400"
      : tone === "success"
        ? "text-emerald-600 dark:text-emerald-400"
        : tone === "warning"
          ? "text-amber-700 dark:text-amber-400"
          : "text-muted-foreground";
  const iconWrapClass =
    tone === "success"
      ? "bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-600/15 dark:text-emerald-300"
      : tone === "warning"
        ? "bg-amber-500/10 text-amber-800 ring-1 ring-amber-600/15 dark:text-amber-300"
        : tone === "danger"
          ? "bg-destructive/10 text-destructive ring-1 ring-destructive/20 dark:text-red-300"
          : "bg-muted text-muted-foreground ring-1 ring-border/60";

  return (
    <Card className="border-border/80 py-4 shadow-sm">
      <CardContent className="flex flex-col gap-2 px-4 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-muted-foreground">{label}</p>
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg",
              iconWrapClass,
            )}
            aria-hidden
          >
            <Icon className="size-4" />
          </span>
        </div>
        {loading ? (
          <>
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-4 w-20" />
          </>
        ) : (
          <>
            <p
              className={cn(
                "text-2xl font-bold tracking-tight tabular-nums sm:text-[1.65rem]",
                valueClass,
              )}
            >
              {formatCurrency(amount)}
            </p>
            <p className={cn("text-xs", subtitleClass)}>{subtitle}</p>
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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <TotalsCard
        label={`A pagar em ${monthName}`}
        amount={totals.toPayInMonth.amount}
        subtitle={formatContasCount(totals.toPayInMonth.count)}
        tone="neutral"
        icon={Wallet}
        loading={loading}
        formatCurrency={formatCurrency}
      />
      <TotalsCard
        label="Vence nos próximos 7 dias"
        amount={totals.dueInNext7Days.amount}
        subtitle={formatContasCount(totals.dueInNext7Days.count)}
        tone={totals.dueInNext7Days.count > 0 ? "warning" : "neutral"}
        icon={CalendarClock}
        loading={loading}
        formatCurrency={formatCurrency}
      />
      <TotalsCard
        label="Vencidas"
        amount={totals.overdue.amount}
        subtitle={overdueSubtitle}
        tone="danger"
        icon={CircleAlert}
        loading={loading}
        formatCurrency={formatCurrency}
      />
      <TotalsCard
        label="Pagas no mês"
        amount={totals.paidInMonth.amount}
        subtitle={formatContasCount(totals.paidInMonth.count)}
        tone="success"
        icon={BadgeCheck}
        loading={loading}
        formatCurrency={formatCurrency}
      />
    </div>
  );
}

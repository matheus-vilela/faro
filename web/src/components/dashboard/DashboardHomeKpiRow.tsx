import { Card, CardContent } from "@/components/ui/card";
import { formatBrl } from "@/lib/dre/formatBrl";
import { formatContasCount } from "@/lib/payableTotals";
import { cn } from "@/lib/utils";
import {
  Banknote,
  CalendarClock,
  Loader2,
  Percent,
  Wallet,
  type LucideIcon,
} from "lucide-react";

function formatPct(pct: number | null): string {
  if (pct == null) return "—";
  return `${Math.round(pct).toLocaleString("pt-BR")}%`;
}

function formatDeltaBadge(pct: number | null): string {
  if (pct == null) return "—";
  const abs = Math.abs(pct);
  return `${abs.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function KpiTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "neutral",
  hintTone = "muted",
  deltaPct,
  loading,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: "neutral" | "success" | "accent" | "warning" | "danger";
  hintTone?: "muted" | "positive" | "warning" | "negative";
  deltaPct?: number | null;
  loading?: boolean;
}) {
  const valueClass =
    tone === "success"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "accent"
        ? "text-sky-700 dark:text-sky-400"
        : tone === "warning"
          ? "text-amber-700 dark:text-amber-400"
          : tone === "danger"
            ? "text-destructive dark:text-red-400"
            : "text-foreground";

  const iconWrapClass =
    tone === "success"
      ? "bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-600/15 dark:text-emerald-300"
      : tone === "accent"
        ? "bg-sky-500/10 text-sky-800 ring-1 ring-sky-600/15 dark:text-sky-300"
        : tone === "warning"
          ? "bg-amber-500/10 text-amber-800 ring-1 ring-amber-600/15 dark:text-amber-300"
          : tone === "danger"
            ? "bg-destructive/10 text-destructive ring-1 ring-destructive/20 dark:text-red-300"
            : "bg-muted text-muted-foreground ring-1 ring-border/60";

  const showDelta = deltaPct !== undefined;
  const positive = deltaPct != null && deltaPct > 0;
  const negative = deltaPct != null && deltaPct < 0;
  const flat = !positive && !negative;

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
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
        ) : (
          <p
            className={cn(
              "text-2xl font-bold tracking-tight tabular-nums sm:text-[1.65rem]",
              valueClass,
            )}
          >
            {value}
          </p>
        )}
        {loading ? null : showDelta ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums",
                positive &&
                  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                negative && "bg-red-500/10 text-red-700 dark:text-red-300",
                flat && "bg-muted text-muted-foreground",
              )}
            >
              {positive ? <span aria-hidden>▲</span> : null}
              {negative ? <span aria-hidden>▼</span> : null}
              {formatDeltaBadge(deltaPct ?? null)}
            </span>
            {hint ? (
              <span className="text-xs text-muted-foreground">{hint}</span>
            ) : null}
          </div>
        ) : hint ? (
          <p
            className={cn(
              "text-xs",
              hintTone === "positive" &&
                "text-emerald-600 dark:text-emerald-400",
              hintTone === "warning" && "text-amber-700 dark:text-amber-400",
              hintTone === "negative" && "text-destructive dark:text-red-400",
              hintTone === "muted" && "text-muted-foreground",
            )}
          >
            {hint}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function DashboardHomeKpiRow({
  loading,
  faturamento,
  faturamentoDeltaPct,
  compareLabel,
  marginPct,
  cmvPct,
  dueIn7Amount,
  dueIn7Count,
  lucroMes,
}: {
  loading: boolean;
  faturamento: number;
  faturamentoDeltaPct: number | null;
  compareLabel: string;
  marginPct: number | null;
  cmvPct: number | null;
  dueIn7Amount: number;
  dueIn7Count: number;
  lucroMes: number | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiTile
        label="Faturamento"
        value={formatBrl(faturamento)}
        hint={compareLabel}
        icon={Banknote}
        tone="success"
        deltaPct={faturamentoDeltaPct}
        loading={loading}
      />
      <KpiTile
        label="Margem média"
        value={formatPct(marginPct)}
        hint={
          cmvPct != null
            ? `CMV em ${formatPct(cmvPct)}`
            : "Sobre a receita líquida"
        }
        icon={Percent}
        tone="accent"
        hintTone="muted"
        loading={loading}
      />
      <KpiTile
        label="A vencer · 7 dias"
        value={formatBrl(dueIn7Amount)}
        hint={
          dueIn7Count > 0
            ? `${formatContasCount(dueIn7Count)} próximas`
            : "Nenhuma conta nos próximos 7 dias"
        }
        icon={CalendarClock}
        tone={dueIn7Count > 0 ? "warning" : "neutral"}
        hintTone={dueIn7Count > 0 ? "warning" : "muted"}
        loading={loading}
      />
      <KpiTile
        label="Resultado do mês"
        value={lucroMes == null ? "—" : formatBrl(lucroMes)}
        hint={
          lucroMes == null
            ? "Lucro líquido (DRE)"
            : lucroMes >= 0
              ? "Lucro líquido"
              : "Resultado negativo"
        }
        icon={Wallet}
        tone={
          lucroMes == null ? "neutral" : lucroMes >= 0 ? "success" : "danger"
        }
        hintTone={
          lucroMes == null ? "muted" : lucroMes >= 0 ? "positive" : "negative"
        }
        loading={loading}
      />
    </div>
  );
}

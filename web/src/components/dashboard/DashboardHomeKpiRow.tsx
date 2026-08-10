import { Card, CardContent } from "@/components/ui/card";
import { formatBrl } from "@/lib/dre/formatBrl";
import { formatContasCount } from "@/lib/payableTotals";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

function formatPct(pct: number | null): string {
  if (pct == null) return "—";
  return `${Math.round(pct).toLocaleString("pt-BR")}%`;
}

function formatDeltaPct(pct: number | null): string | null {
  if (pct == null) return null;
  const abs = Math.abs(pct).toLocaleString("pt-BR", {
    maximumFractionDigits: 0,
  });
  if (pct > 0) return `▲ ${abs}%`;
  if (pct < 0) return `▼ ${abs}%`;
  return `${abs}%`;
}

function KpiTile({
  label,
  value,
  hint,
  hintTone = "muted",
  loading,
}: {
  label: string;
  value: string;
  hint?: string;
  hintTone?: "muted" | "positive" | "warning" | "negative";
  loading?: boolean;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-1.5 p-4 sm:p-5">
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <p className="text-2xl font-bold tracking-tight tabular-nums sm:text-[1.65rem]">
            {value}
          </p>
        )}
        {hint && !loading ? (
          <p
            className={cn(
              "text-xs",
              hintTone === "positive" &&
                "text-emerald-600 dark:text-emerald-400",
              hintTone === "warning" && "text-amber-700 dark:text-amber-400",
              hintTone === "negative" &&
                "text-destructive dark:text-red-400",
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
  const delta = formatDeltaPct(faturamentoDeltaPct);
  const deltaTone =
    faturamentoDeltaPct == null
      ? "muted"
      : faturamentoDeltaPct > 0
        ? "positive"
        : faturamentoDeltaPct < 0
          ? "negative"
          : "muted";

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <KpiTile
        label="Faturamento"
        value={formatBrl(faturamento)}
        hint={delta ? `${delta} ${compareLabel}` : compareLabel}
        hintTone={deltaTone}
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
        hintTone={
          lucroMes == null
            ? "muted"
            : lucroMes >= 0
              ? "positive"
              : "negative"
        }
        loading={loading}
      />
    </div>
  );
}

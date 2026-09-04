import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ListChecks, Loader2 } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import type {
  ChecklistAssignmentStatRow,
  ChecklistPerformancePeriod,
} from "./checklistPerformanceTypes";

const TRACK_FILL = "oklch(0.55 0.02 280 / 0.22)";

function RateRadial({
  rate,
  windowLabel,
  actual,
  expected,
}: {
  rate: number;
  windowLabel: string;
  actual: number;
  expected: number;
}) {
  if (expected <= 0) {
    return (
      <div className="flex min-w-0 flex-1 flex-col items-center gap-2 py-4">
        <p className="text-center text-sm font-medium text-foreground">
          Sem meta neste período
        </p>
        <p className="text-center text-xs text-muted-foreground">
          {windowLabel}
        </p>
        {actual > 0 ? (
          <p className="text-center text-[11px] tabular-nums text-muted-foreground">
            {actual} envio{actual !== 1 ? "s" : ""} mesmo assim
          </p>
        ) : null}
      </div>
    );
  }

  const safe = Math.min(100, Math.max(0, rate));
  const rest = Math.max(0, 100 - safe);

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
      <div className="relative h-[132px] w-[132px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={[{ v: rest }, { v: safe }]}
              startAngle={90}
              endAngle={-270}
              innerRadius="72%"
              outerRadius="100%"
              dataKey="v"
              stroke="none"
              isAnimationActive
            >
              <Cell fill={TRACK_FILL} />
              <Cell fill="var(--primary)" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums leading-none text-foreground">
            {safe}%
          </span>
          <span className="mt-0.5 text-[10px] font-medium text-muted-foreground">
            da meta
          </span>
        </div>
      </div>
      <p className="text-center text-xs font-medium text-muted-foreground">
        {windowLabel}
      </p>
      <p className="text-center text-[11px] tabular-nums text-muted-foreground">
        {actual} de {expected} realizados
      </p>
    </div>
  );
}

function AssignmentRadialBlock({
  s,
  period,
}: {
  s: ChecklistAssignmentStatRow;
  period: Exclude<ChecklistPerformancePeriod, "both">;
}) {
  const actual = period === "7" ? s.actual7 : s.actual30;
  const expected = period === "7" ? s.expected7 : s.expected30;
  const rate = period === "7" ? s.rate7 : s.rate30;
  const windowLabel = period === "7" ? "Últimos 7 dias" : "Últimos 30 dias";

  return (
    <div className="flex justify-center py-1">
      <RateRadial
        rate={rate}
        windowLabel={windowLabel}
        actual={actual}
        expected={expected}
      />
    </div>
  );
}

function BothPeriodsRadialBlock({ s }: { s: ChecklistAssignmentStatRow }) {
  return (
    <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:justify-center sm:gap-8">
      <RateRadial
        rate={s.rate7}
        windowLabel="Últimos 7 dias"
        actual={s.actual7}
        expected={s.expected7}
      />
      <RateRadial
        rate={s.rate30}
        windowLabel="Últimos 30 dias"
        actual={s.actual30}
        expected={s.expected30}
      />
    </div>
  );
}

function SummaryStrip({
  stats,
  period,
}: {
  stats: ChecklistAssignmentStatRow[];
  period: ChecklistPerformancePeriod;
}) {
  if (stats.length === 0) return null;
  const withMeta7 = stats.filter((s) => s.expected7 > 0);
  const withMeta30 = stats.filter((s) => s.expected30 > 0);
  const avg7 =
    withMeta7.length > 0
      ? Math.round(withMeta7.reduce((a, s) => a + s.rate7, 0) / withMeta7.length)
      : null;
  const avg30 =
    withMeta30.length > 0
      ? Math.round(
          withMeta30.reduce((a, s) => a + s.rate30, 0) / withMeta30.length,
        )
      : null;
  const show7 = period === "7" || period === "both";
  const show30 = period === "30" || period === "both";
  return (
    <div className="mb-4 flex flex-wrap gap-3 rounded-lg border border-dashed border-border/80 bg-muted/20 px-3 py-2 text-sm">
      <span className="text-muted-foreground">Média da equipe</span>
      {show7 ? (
        <Badge variant="secondary" className="tabular-nums">
          7d: {avg7 == null ? "—" : `${avg7}%`}
        </Badge>
      ) : null}
      {show30 ? (
        <Badge variant="outline" className="tabular-nums">
          30d: {avg30 == null ? "—" : `${avg30}%`}
        </Badge>
      ) : null}
    </div>
  );
}

type Props = {
  stats: ChecklistAssignmentStatRow[];
  loading: boolean;
  period: ChecklistPerformancePeriod;
  onPeriodChange: (p: ChecklistPerformancePeriod) => void;
};

export function ChecklistPerformanceSection({
  stats,
  loading,
  period,
  onPeriodChange,
}: Props) {
  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4" />
              Atingimento da meta
            </CardTitle>
            <CardDescription className="mt-1 max-w-prose">
              Quantas vezes o checklist foi feito versus o esperado no período
              (recorrência).
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-col gap-1.5 sm:items-end">
            <span className="text-xs text-muted-foreground">Período</span>
            <Select
              value={period}
              onValueChange={(v) =>
                onPeriodChange(v as ChecklistPerformancePeriod)
              }
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Período" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Últimos 7 dias</SelectItem>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
                <SelectItem value="both">7 e 30 dias (comparar)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando atingimento da meta…
          </div>
        ) : stats.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma atribuição em checklist ativo. Atribua operadores para ver
            a meta.
          </p>
        ) : (
          <>
            <SummaryStrip stats={stats} period={period} />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {stats.map((s) => (
                <div
                  key={s.key}
                  className="rounded-xl border border-border/80 bg-card p-4 shadow-sm "
                >
                  <div className="mb-3 border-b border-border/60 pb-3">
                    <p className="font-medium leading-snug">
                      {s.checklistTitle}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.recurrenceSummary}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-xs font-normal">
                        {s.memberName}
                      </Badge>
                    </div>
                  </div>
                  {period === "both" ? (
                    <BothPeriodsRadialBlock s={s} />
                  ) : (
                    <AssignmentRadialBlock s={s} period={period} />
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

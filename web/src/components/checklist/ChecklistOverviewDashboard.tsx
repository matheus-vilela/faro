import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChecklistRankingTable } from "@/components/checklist/ChecklistRankingTable";
import {
  buildOverviewDashboard,
  completionRate,
  formatYmdRangeLabel,
  kpiPercent,
  overviewPeriodLabel,
  overviewPeriodRange,
  type OverviewKpis,
  type OverviewPeriodKind,
} from "@/lib/checklistOverview";
import { loadChecklistOverviewInputs } from "@/lib/loadChecklistOverview";
import { spAddCalendarDays, spTodayYmd } from "@/lib/checklistSpDay";
import { cn } from "@/lib/utils";
import { CalendarRange, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const PERIOD_PILLS: OverviewPeriodKind[] = ["today", "week", "month"];

const KPI_CARDS: {
  key: keyof OverviewKpis;
  label: string;
  valueClass: string;
  barClass: string;
}[] = [
  {
    key: "scheduled",
    label: "Agendados",
    valueClass: "text-sky-700 dark:text-sky-400",
    barClass: "bg-sky-500",
  },
  {
    key: "notStarted",
    label: "Não iniciado",
    valueClass: "text-zinc-600 dark:text-zinc-300",
    barClass: "bg-zinc-400",
  },
  {
    key: "inProgress",
    label: "Em andamento",
    valueClass: "text-blue-700 dark:text-blue-400",
    barClass: "bg-blue-500",
  },
  {
    key: "late",
    label: "Atrasado",
    valueClass: "text-red-700 dark:text-red-400",
    barClass: "bg-red-500",
  },
  {
    key: "finished",
    label: "Finalizado",
    valueClass: "text-emerald-700 dark:text-emerald-400",
    barClass: "bg-emerald-500",
  },
];

const TRACK_FILL = "oklch(0.55 0.02 280 / 0.22)";

function EvolutionTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const byKey = Object.fromEntries(payload.map((p) => [p.dataKey, p.value]));
  const expected = byKey.expected ?? 0;
  const finished = byKey.finished ?? 0;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium">{label}</p>
      <p className="text-muted-foreground">
        Esperado:{" "}
        <span className="font-medium text-foreground tabular-nums">{expected}</span>
      </p>
      <p className="text-muted-foreground">
        Feito:{" "}
        <span className="font-medium text-foreground tabular-nums">{finished}</span>
      </p>
    </div>
  );
}

export function ChecklistOverviewDashboard({
  companyId,
  reloadNonce = 0,
}: {
  companyId: string;
  reloadNonce?: number;
}) {
  const [kind, setKind] = useState<OverviewPeriodKind>("today");
  const [customFrom, setCustomFrom] = useState(() =>
    spAddCalendarDays(spTodayYmd(), -6),
  );
  const [customTo, setCustomTo] = useState(() => spTodayYmd());
  const [periodOpen, setPeriodOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState(() =>
    buildOverviewDashboard({
      kind: "today",
      assignments: [],
      runs: [],
    }),
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const range = overviewPeriodRange(kind, customFrom, customTo);
      const inputs = await loadChecklistOverviewInputs(
        companyId,
        range.startYmd,
        range.endYmd,
      );
      setModel(
        buildOverviewDashboard({
          kind,
          customFrom,
          customTo,
          assignments: inputs.assignments,
          runs: inputs.runs,
        }),
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [companyId, kind, customFrom, customTo]);

  useEffect(() => {
    void load();
  }, [load, reloadNonce]);

  const rate = completionRate(model.kpis);
  const rest = Math.max(0, 100 - rate);
  const donutData = useMemo(
    () => [
      { key: "rest", v: rest },
      { key: "done", v: rate },
    ],
    [rate, rest],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Resumo da equipe</h2>
          <p className="text-xs text-muted-foreground">
            {formatYmdRangeLabel(model.range.startYmd, model.range.endYmd)} ·
            horário de São Paulo
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-muted/30 p-1">
          {PERIOD_PILLS.map((p) => (
            <Button
              key={p}
              type="button"
              size="sm"
              variant={kind === p ? "default" : "ghost"}
              className="h-8"
              onClick={() => setKind(p)}
            >
              {overviewPeriodLabel(p)}
            </Button>
          ))}
          <Popover open={periodOpen} onOpenChange={setPeriodOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant={kind === "custom" ? "default" : "ghost"}
                className="h-8"
              >
                <CalendarRange className="h-3.5 w-3.5" />
                Período
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ov-from">De</Label>
                <Input
                  id="ov-from"
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ov-to">Até</Label>
                <Input
                  id="ov-to"
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
              </div>
              <Button
                type="button"
                size="sm"
                className="w-full"
                onClick={() => {
                  setKind("custom");
                  setPeriodOpen(false);
                }}
              >
                Aplicar
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando resumo…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {KPI_CARDS.map((card) => {
              const value = model.kpis[card.key];
              const pct =
                card.key === "scheduled"
                  ? 100
                  : kpiPercent(value, model.kpis.scheduled);
              return (
                <Card key={card.key} className="shadow-sm">
                  <CardContent className="px-4 py-3">
                    <p className="text-xs text-muted-foreground">{card.label}</p>
                    <p
                      className={cn(
                        "mt-1 text-2xl font-bold tabular-nums leading-none",
                        card.valueClass,
                      )}
                    >
                      {value}
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full", card.barClass)}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
                      {card.key === "scheduled" ? "meta do período" : `${pct}%`}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,16rem)_1fr]">
            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Conclusão</CardTitle>
                <CardDescription>Finalizados versus agendados.</CardDescription>
              </CardHeader>
              <CardContent>
                {model.kpis.scheduled <= 0 && model.kpis.finished <= 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Sem meta neste período.
                  </p>
                ) : (
                  <div className="relative mx-auto h-44 w-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={donutData}
                          dataKey="v"
                          startAngle={90}
                          endAngle={-270}
                          innerRadius="72%"
                          outerRadius="100%"
                          stroke="none"
                          isAnimationActive
                        >
                          <Cell fill={TRACK_FILL} />
                          <Cell fill="var(--primary)" />
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-3xl font-bold tabular-nums leading-none">
                        {rate}%
                      </span>
                      <span className="mt-1 text-[11px] text-muted-foreground">
                        {model.kpis.finished} de {model.kpis.scheduled}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Evolução</CardTitle>
                <CardDescription>
                  Esperado e feito por dia (São Paulo).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={model.dayPoints}
                      margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                    >
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11 }}
                        interval={kind === "month" || kind === "custom" ? 1 : 0}
                      />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip
                        content={<EvolutionTooltip />}
                        cursor={{ fill: "oklch(0.55 0.02 280 / 0.08)" }}
                      />
                      <Bar
                        dataKey="expected"
                        name="Esperado"
                        fill="oklch(0.55 0.02 280 / 0.28)"
                        radius={[3, 3, 0, 0]}
                        maxBarSize={28}
                      />
                      <Bar
                        dataKey="finished"
                        name="Feito"
                        fill="var(--primary)"
                        radius={[3, 3, 0, 0]}
                        maxBarSize={28}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Ranking</CardTitle>
              <CardDescription>
                Feito / esperado no período. Nota = média de Prazo, Completo e
                Preciso. Toque para o detalhe.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChecklistRankingTable
                rows={model.ranking}
                emptyLabel="Nenhuma atribuição em checklist ativo neste período."
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

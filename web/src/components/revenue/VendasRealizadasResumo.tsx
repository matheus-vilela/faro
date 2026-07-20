import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useCompany } from "@/contexts/CompanyContext";
import { localDateYmd } from "@/lib/boletoPayment";
import { formatBrl } from "@/lib/dre/formatBrl";
import { supabase } from "@/lib/supabase";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import { cn } from "@/lib/utils";
import {
  buildVendasRealizadasResumo,
  formatCompactBrl,
  getResumoRanges,
  type ResumoKpiDelta,
  type ResumoPaymentRow,
  type ResumoPeriodFilter,
  type ResumoRankingMode,
} from "@/lib/vendasRealizadasResumo";
import type { CompanyCategory } from "@/types/category";
import type { RevenueEntry } from "@/types/revenue";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const PERIOD_OPTIONS: { value: ResumoPeriodFilter; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "last7", label: "Últimos 7 dias" },
  { value: "month", label: "Este mês" },
];

const RANKING_OPTIONS: { value: ResumoRankingMode; label: string }[] = [
  { value: "product", label: "Por produto" },
  { value: "payment", label: "Por tipo de transação" },
];

const CATEGORY_DOT_COLORS = [
  "bg-primary",
  "bg-orange-300",
  "bg-slate-800",
  "bg-muted-foreground/40",
  "bg-amber-500",
  "bg-sky-600",
];

/** Cores do donut / legenda (alinhadas ao print). */
const PAYMENT_CHART_COLORS = [
  "var(--primary)",
  "#fdba74",
  "#1e293b",
  "#94a3b8",
  "#e2e8f0",
  "#f59e0b",
];

function formatPct(pct: number | null): string {
  if (pct == null) return "—";
  const abs = Math.abs(pct);
  return `${abs.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function formatSharePct(share: number): string {
  return `${(share * 100).toLocaleString("pt-BR", {
    maximumFractionDigits: 0,
  })}%`;
}

function KpiCard({
  label,
  delta,
  compareLabel,
  formatValue,
}: {
  label: string;
  delta: ResumoKpiDelta;
  compareLabel: string;
  formatValue: (v: number) => string;
}) {
  const pct = delta.pctChange;
  const positive = pct != null && pct > 0;
  const negative = pct != null && pct < 0;
  const flat = pct === 0 || pct == null;

  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-2 p-4 sm:p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold tracking-tight tabular-nums text-foreground sm:text-[1.65rem]">
          {formatValue(delta.current)}
        </p>
        <p
          className={cn(
            "flex items-center gap-1 text-xs font-medium",
            positive && "text-emerald-600",
            negative && "text-red-600",
            flat && "text-muted-foreground",
          )}
        >
          {positive && <span aria-hidden>▲</span>}
          {negative && <span aria-hidden>▼</span>}
          <span>
            {formatPct(pct)} {compareLabel}
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

function PaymentParticipationDonut({
  rows,
  totalAmount,
  periodShortLabel,
}: {
  rows: ResumoPaymentRow[];
  totalAmount: number;
  periodShortLabel: string;
}) {
  const data = rows.map((r) => ({
    key: r.key,
    name: r.shortLabel,
    value: r.amount,
    share: r.share,
  }));

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">
          Participação por forma
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="relative mx-auto h-44 w-44">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                innerRadius="68%"
                outerRadius="100%"
                stroke="none"
                startAngle={90}
                endAngle={-270}
                isAnimationActive
              >
                {data.map((entry, i) => (
                  <Cell
                    key={entry.key}
                    fill={PAYMENT_CHART_COLORS[i % PAYMENT_CHART_COLORS.length]}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-3 text-center">
            <span className="text-lg font-bold tabular-nums leading-tight text-foreground sm:text-xl">
              {formatBrl(totalAmount)}
            </span>
            <span className="mt-0.5 text-[11px] text-muted-foreground">
              {periodShortLabel}
            </span>
          </div>
        </div>

        <ul className="mt-4 divide-y divide-border/70">
          {rows.map((row, i) => (
            <li
              key={row.key}
              className="flex items-center gap-2.5 py-2.5 text-sm"
            >
              <span
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{
                  backgroundColor:
                    PAYMENT_CHART_COLORS[i % PAYMENT_CHART_COLORS.length],
                }}
              />
              <span className="min-w-0 flex-1 truncate font-medium">
                {row.shortLabel}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {formatSharePct(row.share)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function PaymentMethodsPanel({
  rows,
  championsTitle,
  periodShortLabel,
}: {
  rows: ResumoPaymentRow[];
  championsTitle: string;
  periodShortLabel: string;
}) {
  const maxShare = rows.reduce((m, r) => Math.max(m, r.share), 0);
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);

  if (rows.length === 0) {
    return (
      <Card className="shadow-sm">
        <CardContent className="space-y-1 py-12 text-center text-sm text-muted-foreground">
          <p>Nenhuma forma de pagamento identificada neste período.</p>
          <p className="text-xs">
            As vendas ainda não registram cartão, Pix, dinheiro etc. no Faro.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="shadow-sm lg:col-span-3">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Como seu cliente pagou — {championsTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto pt-0">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 pr-3 font-semibold">Forma de pagamento</th>
                <th className="pb-2 pr-3 text-right font-semibold">
                  Transações
                </th>
                <th className="pb-2 pr-3 text-right font-semibold">Valor</th>
                <th className="pb-2 pr-3 text-right font-semibold">
                  Tíquete médio
                </th>
                <th className="pb-2 font-semibold">% do total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const barPct =
                  maxShare > 0
                    ? Math.min(100, (row.share / maxShare) * 100)
                    : 0;
                return (
                  <tr
                    key={row.key}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="py-3 pr-3 font-medium text-foreground">
                      {row.label}
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums">
                      {row.count.toLocaleString("pt-BR")}
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums font-medium">
                      {formatBrl(row.amount)}
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums">
                      {formatBrl(row.ticket)}
                    </td>
                    <td className="py-3 min-w-[8rem]">
                      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${barPct}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="lg:col-span-2">
        <PaymentParticipationDonut
          rows={rows}
          totalAmount={totalAmount}
          periodShortLabel={periodShortLabel}
        />
      </div>
    </div>
  );
}

export function VendasRealizadasResumo() {
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;

  const [period, setPeriod] = useState<ResumoPeriodFilter>("last7");
  const [rankingMode, setRankingMode] = useState<ResumoRankingMode>("product");
  const [entries, setEntries] = useState<RevenueEntry[]>([]);
  const [categories, setCategories] = useState<CompanyCategory[]>([]);
  const [productNameById, setProductNameById] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [recipeNameById, setRecipeNameById] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(true);

  const todayYmd = localDateYmd();
  const ranges = useMemo(
    () => getResumoRanges(period, todayYmd),
    [period, todayYmd],
  );

  const fetchData = useCallback(async () => {
    if (!companyId) {
      setEntries([]);
      setCategories([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { fetchStart, fetchEnd } = getResumoRanges(period, localDateYmd());

      const [revenueRows, catRows] = await Promise.all([
        fetchAllInRange<RevenueEntry>(
          supabase
            .from("revenue_entries")
            .select("*")
            .eq("company_id", companyId)
            .gte("entry_date", fetchStart)
            .lte("entry_date", fetchEnd)
            .order("entry_date", { ascending: true }),
        ),
        supabase
          .from("company_categories")
          .select("*")
          .eq("company_id", companyId)
          .then(({ data, error }) => {
            if (error) throw error;
            return (data as CompanyCategory[]) ?? [];
          }),
      ]);

      const productIds = [
        ...new Set(
          revenueRows
            .map((r) => r.product_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const recipeIds = [
        ...new Set(
          revenueRows
            .map((r) => r.recipe_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ];

      const [productsRes, recipesRes] = await Promise.all([
        productIds.length
          ? supabase.from("products").select("id, name").in("id", productIds)
          : Promise.resolve({ data: [], error: null }),
        recipeIds.length
          ? supabase.from("recipes").select("id, name").in("id", recipeIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (productsRes.error) throw productsRes.error;
      if (recipesRes.error) throw recipesRes.error;

      setEntries(revenueRows);
      setCategories(catRows);
      setProductNameById(
        new Map(
          ((productsRes.data as { id: string; name: string }[]) ?? []).map(
            (p) => [p.id, p.name],
          ),
        ),
      );
      setRecipeNameById(
        new Map(
          ((recipesRes.data as { id: string; name: string }[]) ?? []).map(
            (r) => [r.id, r.name],
          ),
        ),
      );
    } catch (err) {
      console.error(err);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, period]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const categoriesById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const dashboard = useMemo(
    () =>
      buildVendasRealizadasResumo({
        entries,
        period,
        todayYmd,
        rankingMode,
        categoriesById,
        productNameById,
        recipeNameById,
      }),
    [
      entries,
      period,
      todayYmd,
      rankingMode,
      categoriesById,
      productNameById,
      recipeNameById,
    ],
  );

  const chartData = useMemo(
    () =>
      dashboard.daily.map((d) => ({
        ...d,
        display: formatCompactBrl(d.net),
      })),
    [dashboard.daily],
  );

  const hasSales = dashboard.kpis.count.current > 0;
  const maxChampionShare = dashboard.champions.reduce(
    (m, r) => Math.max(m, r.revenueShare),
    0,
  );

  return (
    <div className="space-y-4">
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Período do resumo"
      >
        {PERIOD_OPTIONS.map((opt) => {
          const active = period === opt.value;
          return (
            <Button
              key={opt.value}
              type="button"
              variant={active ? "default" : "outline"}
              size="sm"
              onClick={() => setPeriod(opt.value)}
              className={cn(
                "h-9 rounded-full px-4 text-sm font-medium",
                active
                  ? "bg-foreground text-background hover:bg-foreground/90 hover:text-background"
                  : "bg-background",
              )}
            >
              {opt.label}
            </Button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Carregando resumo…
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Vendas brutas"
              delta={dashboard.kpis.gross}
              compareLabel={ranges.compareLabel}
              formatValue={formatBrl}
            />
            <KpiCard
              label="Vendas líquidas"
              delta={dashboard.kpis.net}
              compareLabel={ranges.compareLabel}
              formatValue={formatBrl}
            />
            <KpiCard
              label="Transações"
              delta={dashboard.kpis.count}
              compareLabel={ranges.compareLabel}
              formatValue={(v) => Math.round(v).toLocaleString("pt-BR")}
            />
            <KpiCard
              label="Tíquete médio"
              delta={dashboard.kpis.ticket}
              compareLabel={ranges.compareLabel}
              formatValue={formatBrl}
            />
          </div>

          <div
            className="inline-flex max-w-full flex-wrap rounded-full bg-muted p-1"
            role="tablist"
            aria-label="Visão do detalhamento"
          >
            {RANKING_OPTIONS.map((opt) => {
              const active = rankingMode === opt.value;
              return (
                <Button
                  key={opt.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  variant="ghost"
                  size="sm"
                  onClick={() => setRankingMode(opt.value)}
                  className={cn(
                    "h-8 rounded-full px-3 text-sm font-medium shadow-none",
                    active
                      ? "bg-background text-foreground shadow-sm hover:bg-background"
                      : "text-muted-foreground hover:bg-transparent hover:text-foreground",
                  )}
                >
                  {opt.label}
                </Button>
              );
            })}
          </div>

          {!hasSales ? (
            <Card className="shadow-sm">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Nenhuma venda operacional neste período.
              </CardContent>
            </Card>
          ) : rankingMode === "payment" ? (
            <PaymentMethodsPanel
              rows={dashboard.payments}
              championsTitle={dashboard.ranges.championsTitle}
              periodShortLabel={dashboard.ranges.periodShortLabel}
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-5">
              <Card className="shadow-sm lg:col-span-3">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">
                    Campeões de venda – {dashboard.ranges.championsTitle}
                  </CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto pt-0">
                  <table className="w-full min-w-[32rem] border-collapse text-sm">
                    <thead>
                      <tr className="border-b text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <th className="pb-2 pr-3 font-semibold">Produto</th>
                        <th className="pb-2 pr-3 font-semibold">Categoria</th>
                        <th className="pb-2 pr-3 text-right font-semibold">
                          Qtde
                        </th>
                        <th className="pb-2 pr-3 text-right font-semibold">
                          Receita
                        </th>
                        <th className="pb-2 font-semibold">% da receita</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.champions.map((row) => {
                        const barPct =
                          maxChampionShare > 0
                            ? Math.min(
                                100,
                                (row.revenueShare / maxChampionShare) * 100,
                              )
                            : 0;
                        return (
                          <tr
                            key={row.key}
                            className="border-b border-border/60 last:border-0"
                          >
                            <td className="py-3 pr-3 font-medium text-foreground">
                              {row.label}
                            </td>
                            <td className="py-3 pr-3 text-muted-foreground">
                              {row.categoryLabel}
                            </td>
                            <td className="py-3 pr-3 text-right tabular-nums">
                              {row.quantity.toLocaleString("pt-BR", {
                                maximumFractionDigits: 2,
                              })}
                            </td>
                            <td className="py-3 pr-3 text-right tabular-nums font-medium">
                              {formatBrl(row.revenue)}
                            </td>
                            <td className="py-3 min-w-[8rem]">
                              <div className="flex items-center gap-2">
                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                                  <div
                                    className="h-full rounded-full bg-primary"
                                    style={{ width: `${barPct}%` }}
                                  />
                                </div>
                                <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                                  {formatSharePct(row.revenueShare)}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              <div className="flex flex-col gap-4 lg:col-span-2">
                <Card className="shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-semibold">
                      Vendas por dia
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="h-52 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={chartData}
                          margin={{ top: 20, right: 4, left: 0, bottom: 0 }}
                        >
                          <CartesianGrid
                            vertical={false}
                            strokeDasharray="3 3"
                            className="stroke-border"
                          />
                          <XAxis
                            dataKey="label"
                            tickLine={false}
                            axisLine={false}
                            tick={{ fontSize: 11 }}
                            interval={
                              period === "month" ? "preserveStartEnd" : 0
                            }
                          />
                          <YAxis hide />
                          <Tooltip
                            formatter={(value: number) => [
                              formatBrl(value),
                              "Receita líquida",
                            ]}
                            labelFormatter={(_, payload) => {
                              const row = payload?.[0]?.payload as
                                | { date?: string }
                                | undefined;
                              return row?.date
                                ? new Date(
                                    `${row.date}T12:00:00`,
                                  ).toLocaleDateString("pt-BR")
                                : "";
                            }}
                          />
                          <Bar
                            dataKey="net"
                            fill="var(--primary)"
                            radius={[4, 4, 0, 0]}
                            maxBarSize={36}
                          >
                            <LabelList
                              dataKey="display"
                              position="top"
                              className="fill-muted-foreground"
                              style={{ fontSize: 10 }}
                            />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-semibold">
                      Receita por categoria
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    {dashboard.categories.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Sem categorias no período.
                      </p>
                    ) : (
                      dashboard.categories.map((row, i) => (
                        <div
                          key={row.key}
                          className="flex items-center gap-3 text-sm"
                        >
                          <span
                            className={cn(
                              "h-2.5 w-2.5 shrink-0 rounded-full",
                              CATEGORY_DOT_COLORS[
                                i % CATEGORY_DOT_COLORS.length
                              ],
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {row.label}
                          </span>
                          <span className="shrink-0 tabular-nums font-medium">
                            {formatBrl(row.revenue)}
                          </span>
                          <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                            {formatSharePct(row.share)}
                          </span>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

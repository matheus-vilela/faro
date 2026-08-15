import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useCompany } from "@/contexts/CompanyContext";
import { localDateYmd } from "@/lib/boletoPayment";
import { formatBrl } from "@/lib/dre/formatBrl";
import { addDaysYmd } from "@/lib/payableTotals";
import { supabase } from "@/lib/supabase";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import { cn } from "@/lib/utils";
import {
  buildVendasRealizadasResumo,
  formatCompactBrl,
  getResumoRanges,
  isPenduraPaymentMethod,
  normalizeWeekStartsOn,
  type EpocFaturamentoDayInput,
  type EpocPaymentLineInput,
  type ResumoKpiDelta,
  type ResumoPaymentRow,
  type ResumoPeriodFilter,
  type ResumoRankingMode,
} from "@/lib/vendasRealizadasResumo";
import { nestedRelation } from "@/types/acquirer";
import type { CompanyCategory } from "@/types/category";
import type { RevenueEntry } from "@/types/revenue";
import {
  Banknote,
  Hash,
  Loader2,
  Receipt,
  Ticket,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
  { value: "last7", label: "Esta semana" },
  { value: "month", label: "Este mês" },
  { value: "custom", label: "Personalizado" },
];

function normalizeEpocPaymentRows(rows: unknown[]): EpocPaymentLineInput[] {
  return rows.map((raw) => {
    const row = raw as {
      faturamento_date: string;
      amount: number | null;
      payment_method_id: string;
      payment_methods:
        | {
            sku: string;
            name: string;
            include_in_net_sales?: boolean | null;
            acquirers?: { name: string } | { name: string }[] | null;
          }
        | {
            sku: string;
            name: string;
            include_in_net_sales?: boolean | null;
            acquirers?: { name: string } | { name: string }[] | null;
          }[]
        | null;
    };
    const pm = Array.isArray(row.payment_methods)
      ? (row.payment_methods[0] ?? null)
      : (row.payment_methods ?? null);
    return {
      faturamento_date: row.faturamento_date,
      amount: row.amount,
      payment_method_id: row.payment_method_id,
      payment_methods: pm
        ? {
            sku: pm.sku,
            name: pm.name,
            include_in_net_sales: pm.include_in_net_sales !== false,
            acquirer_name: nestedRelation(pm.acquirers)?.name?.trim() || null,
          }
        : null,
    };
  });
}

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
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  delta: ResumoKpiDelta;
  compareLabel: string;
  formatValue: (v: number) => string;
  icon: LucideIcon;
  tone?: "neutral" | "success" | "accent";
}) {
  const pct = delta.pctChange;
  const positive = pct != null && pct > 0;
  const negative = pct != null && pct < 0;
  const flat = pct === 0 || pct == null;

  const valueClass =
    tone === "success"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "accent"
        ? "text-sky-700 dark:text-sky-400"
        : "text-foreground";

  const iconWrapClass =
    tone === "success"
      ? "bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-600/15 dark:text-emerald-300"
      : tone === "accent"
        ? "bg-sky-500/10 text-sky-800 ring-1 ring-sky-600/15 dark:text-sky-300"
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
        <p
          className={cn(
            "text-2xl font-bold tracking-tight tabular-nums sm:text-[1.65rem]",
            valueClass,
          )}
        >
          {formatValue(delta.current)}
        </p>
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
            {formatPct(pct)}
          </span>
          <span className="text-xs text-muted-foreground">{compareLabel}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function PaymentDonutTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload?: {
      name?: string;
      value?: number;
      share?: number;
      key?: string;
    };
    color?: string;
  }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const color = payload[0]?.color ?? "var(--primary)";
  const name = row.name?.trim() || "Forma de pagamento";
  const amount = Number(row.value) || 0;
  const share = typeof row.share === "number" ? row.share : null;

  return (
    <div className="min-w-[11rem] rounded-xl border border-border/80 bg-popover px-3.5 py-3 text-popover-foreground shadow-lg ring-1 ring-border/40">
      <div className="flex items-start gap-2.5">
        <span
          className="mt-1 size-2.5 shrink-0 rounded-sm ring-1 ring-black/5 dark:ring-white/10"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-sm leading-snug font-semibold">{name}</p>
          <div className="space-y-0.5">
            <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              Valor total
            </p>
            <p className="text-sm font-bold tabular-nums">
              {formatBrl(amount)}
            </p>
          </div>
          <div className="space-y-0.5 border-t border-border/70 pt-2">
            <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              Participação
            </p>
            <p className="text-sm font-semibold tabular-nums">
              {share == null ? "—" : formatSharePct(share)}
            </p>
          </div>
        </div>
      </div>
    </div>
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
          Participação por forma de pagamento
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="relative mx-auto h-64 w-64">
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
              <Tooltip
                content={<PaymentDonutTooltip />}
                cursor={false}
                wrapperStyle={{ outline: "none", zIndex: 1000 }}
              />
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
                {row.acquirerName ? (
                  <span className="block truncate text-xs font-normal text-muted-foreground">
                    {row.acquirerName}
                  </span>
                ) : null}
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

function groupPaymentsByAcquirer(rows: ResumoPaymentRow[]) {
  const map = new Map<string, { label: string; amount: number }>();
  for (const r of rows) {
    const key = r.acquirerName?.trim() || "__none__";
    const label = r.acquirerName?.trim() || "Sem adquirente";
    const prev = map.get(key);
    if (prev) prev.amount += r.amount;
    else map.set(key, { label, amount: r.amount });
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
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
  const netSalesAmount = rows
    .filter((r) => r.includeInNetSales)
    .reduce((s, r) => s + r.amount, 0);
  const excludedAmount = totalAmount - netSalesAmount;
  const penduraAmount = rows
    .filter((r) => isPenduraPaymentMethod(r.key, r.label) || isPenduraPaymentMethod(null, r.shortLabel))
    .reduce((s, r) => s + r.amount, 0);
  const penduraShare = totalAmount > 0 ? penduraAmount / totalAmount : 0;

  if (rows.length === 0) {
    return (
      <Card className="shadow-sm">
        <CardContent className="space-y-1 py-12 text-center text-sm text-muted-foreground">
          <p>Nenhuma forma de pagamento neste período.</p>
          <p className="text-xs">
            Os dados vêm do faturamento EPOC. Sincronize o PDV ou abra a aba
            Faturamento.
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
          <div className="space-y-1 text-sm">
            <p className="font-medium text-foreground">
              Contabilizado na líquida: {formatBrl(netSalesAmount)}
              {excludedAmount > 0 ? (
                <span className="ml-1 font-normal text-muted-foreground">
                  (excluído: {formatBrl(excludedAmount)})
                </span>
              ) : null}
            </p>
            {penduraAmount > 0 ? (
              <p className="font-medium text-amber-800 dark:text-amber-300">
                Pendura no período: {formatBrl(penduraAmount)} (
                {(penduraShare * 100).toLocaleString("pt-BR", {
                  maximumFractionDigits: 1,
                })}
                % da soma das formas)
              </p>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto pt-0">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="pb-2 pr-3 font-semibold">Forma de pagamento</th>
                <th className="pb-2 pr-3 font-semibold">Adquirente</th>
                <th className="pb-2 pr-3 text-right font-semibold">Valor</th>
                <th className="pb-2 font-semibold">% do total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const barPct =
                  maxShare > 0
                    ? Math.min(100, (row.share / maxShare) * 100)
                    : 0;
                const isPendura =
                  isPenduraPaymentMethod(row.key, row.label) ||
                  isPenduraPaymentMethod(null, row.shortLabel);
                const excluded = !row.includeInNetSales;
                return (
                  <tr
                    key={row.key}
                    className={cn(
                      "border-b border-border/60 last:border-0",
                      isPendura && "bg-amber-500/10",
                      excluded && "bg-muted/40",
                    )}
                  >
                    <td
                      className={cn(
                        "py-3 pr-3 font-medium text-foreground",
                        isPendura && "text-amber-900 dark:text-amber-200",
                        excluded && "text-muted-foreground",
                      )}
                    >
                      {row.label}
                      {isPendura ? (
                        <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                          pendura
                        </span>
                      ) : null}
                      {excluded ? (
                        <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          fora da líquida
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3 text-muted-foreground">
                      {row.acquirerName ?? "—"}
                    </td>
                    <td className="py-3 pr-3 text-right tabular-nums font-medium">
                      {formatBrl(row.amount)}
                    </td>
                    <td className="py-3 min-w-[8rem]">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              excluded
                                ? "bg-muted-foreground/40"
                                : isPendura
                                  ? "bg-amber-500"
                                  : "bg-primary",
                            )}
                            style={{ width: `${barPct}%` }}
                          />
                        </div>
                        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {formatSharePct(row.share)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.some((r) => r.acquirerName) ? (
            <div className="mt-4 space-y-2 border-t border-border/70 pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Por adquirente
              </p>
              <ul className="space-y-1.5 text-sm">
                {groupPaymentsByAcquirer(rows).map((item) => (
                  <li
                    key={item.label}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="tabular-nums font-medium">
                      {formatBrl(item.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="lg:col-span-2">
        <PaymentParticipationDonut
          rows={(() => {
            const included = rows.filter((r) => r.includeInNetSales);
            const t = included.reduce((s, r) => s + r.amount, 0);
            return included.map((r) => ({
              ...r,
              share: t > 0 ? r.amount / t : 0,
            }));
          })()}
          totalAmount={netSalesAmount}
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
  const [customStart, setCustomStart] = useState(() =>
    addDaysYmd(localDateYmd(), -6),
  );
  const [customEnd, setCustomEnd] = useState(() => localDateYmd());
  const [rankingMode, setRankingMode] = useState<ResumoRankingMode>("product");
  const [entries, setEntries] = useState<RevenueEntry[]>([]);
  const [epocPayments, setEpocPayments] = useState<EpocPaymentLineInput[]>([]);
  const [epocFaturamentoDays, setEpocFaturamentoDays] = useState<
    EpocFaturamentoDayInput[]
  >([]);
  const [categories, setCategories] = useState<CompanyCategory[]>([]);
  const [productNameById, setProductNameById] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [recipeNameById, setRecipeNameById] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(true);

  const todayYmd = localDateYmd();
  const weekStartsOn = normalizeWeekStartsOn(
    currentCompany?.accounting_week_starts_on,
  );
  const rangeOptions = useMemo(
    () => ({ weekStartsOn }),
    [weekStartsOn],
  );
  const customRange = useMemo(
    () => ({ start: customStart, end: customEnd }),
    [customStart, customEnd],
  );
  const ranges = useMemo(
    () => getResumoRanges(period, todayYmd, customRange, rangeOptions),
    [period, todayYmd, customRange, rangeOptions],
  );

  const selectPeriod = useCallback(
    (next: ResumoPeriodFilter) => {
      if (next === "custom" && period !== "custom") {
        const preset = getResumoRanges(
          period,
          localDateYmd(),
          null,
          rangeOptions,
        );
        setCustomStart(preset.currentStart);
        setCustomEnd(preset.currentEnd);
      }
      setPeriod(next);
    },
    [period, rangeOptions],
  );

  const fetchData = useCallback(async () => {
    if (!companyId) {
      setEntries([]);
      setEpocPayments([]);
      setEpocFaturamentoDays([]);
      setCategories([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { fetchStart, fetchEnd } = getResumoRanges(
        period,
        localDateYmd(),
        { start: customStart, end: customEnd },
        { weekStartsOn },
      );

      const [revenueRows, epocPaymentRows, epocFatRows, catRows] =
        await Promise.all([
          fetchAllInRange<RevenueEntry>(
            supabase
              .from("revenue_entries")
              .select("*")
              .eq("company_id", companyId)
              .gte("entry_date", fetchStart)
              .lte("entry_date", fetchEnd)
              .order("entry_date", { ascending: true }),
          ),
          fetchAllInRange(
            supabase
              .from("epoc_faturamento_daily_payment_methods")
              .select(
                "faturamento_date, amount, payment_method_id, payment_methods ( sku, name, include_in_net_sales, acquirers ( name ) )",
              )
              .eq("company_id", companyId)
              .gte("faturamento_date", fetchStart)
              .lte("faturamento_date", fetchEnd)
              .order("faturamento_date", { ascending: true }),
          ).then((rows) => normalizeEpocPaymentRows(rows)),
          fetchAllInRange(
            supabase
              .from("epoc_faturamento_daily")
              .select(
                "faturamento_date, quantity, produtos, servicos, taxas, total, ticket_medio",
              )
              .eq("company_id", companyId)
              .gte("faturamento_date", fetchStart)
              .lte("faturamento_date", fetchEnd)
              .order("faturamento_date", { ascending: true }),
          ).then((rows) => rows as unknown as EpocFaturamentoDayInput[]),
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
      setEpocPayments(epocPaymentRows);
      setEpocFaturamentoDays(epocFatRows);
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
      setEpocPayments([]);
      setEpocFaturamentoDays([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, period, customStart, customEnd, weekStartsOn]);

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
        epocPayments,
        epocFaturamentoDays,
        customRange,
        weekStartsOn,
      }),
    [
      entries,
      period,
      todayYmd,
      rankingMode,
      categoriesById,
      productNameById,
      recipeNameById,
      epocPayments,
      epocFaturamentoDays,
      customRange,
      weekStartsOn,
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

  const hasSales = dashboard.hasPeriodSales;
  const maxChampionShare = dashboard.champions.reduce(
    (m, r) => Math.max(m, r.revenueShare),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
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
                onClick={() => selectPeriod(opt.value)}
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
        {period === "last7" ? (
          <p className="text-xs text-muted-foreground">
            Semana contábil {ranges.currentStart} → {ranges.currentEnd} (
            {ranges.periodShortLabel}).{" "}
            <Link
              to="/app/configuracoes/semana-contabil"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Alterar dias da semana
            </Link>
          </p>
        ) : null}
        {period === "custom" ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-xs text-muted-foreground">
              De
              <Input
                type="date"
                value={customStart}
                max={customEnd}
                onChange={(e) => setCustomStart(e.target.value)}
                className="h-9 w-[11.5rem]"
              />
            </label>
            <label className="grid gap-1 text-xs text-muted-foreground">
              Até
              <Input
                type="date"
                value={customEnd}
                min={customStart}
                max={todayYmd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="h-9 w-[11.5rem]"
              />
            </label>
            <p className="pb-2 text-xs text-muted-foreground">
              {ranges.currentStart} → {ranges.currentEnd}
            </p>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Carregando resumo…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Vendas brutas"
              delta={dashboard.kpis.gross}
              compareLabel={ranges.compareLabel}
              formatValue={formatBrl}
              icon={Receipt}
            />
            <KpiCard
              label="Vendas líquidas"
              delta={dashboard.kpis.net}
              compareLabel={ranges.compareLabel}
              formatValue={formatBrl}
              icon={Banknote}
              tone="success"
            />
            <KpiCard
              label="Transações"
              delta={dashboard.kpis.count}
              compareLabel={ranges.compareLabel}
              formatValue={(v) => Math.round(v).toLocaleString("pt-BR")}
              icon={Hash}
            />
            <KpiCard
              label="Tíquete médio"
              delta={dashboard.kpis.ticket}
              compareLabel={ranges.compareLabel}
              formatValue={formatBrl}
              icon={Ticket}
              tone="accent"
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
                      ? "bg-ring text-foreground shadow-sm hover:!bg-ring/80"
                      : "text-muted-foreground hover:bg-ring hover:text-foreground",
                  )}
                >
                  {opt.label}
                </Button>
              );
            })}
          </div>

          {rankingMode === "payment" ? (
            <PaymentMethodsPanel
              rows={dashboard.payments}
              championsTitle={dashboard.ranges.championsTitle}
              periodShortLabel={dashboard.ranges.periodShortLabel}
            />
          ) : !hasSales ? (
            <Card className="shadow-sm">
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Nenhuma venda operacional neste período.
              </CardContent>
            </Card>
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

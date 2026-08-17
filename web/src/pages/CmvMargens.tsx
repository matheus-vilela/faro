import { CmvProductDetailSheet } from "@/components/cmv/CmvProductDetailSheet";
import { FaroTipBand } from "@/components/FaroTipBand";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useCompany } from "@/contexts/CompanyContext";
import { localDateYmd } from "@/lib/boletoPayment";
import {
  BCG_QUADRANT_LABELS,
  buildCmvMargensDashboard,
  CMV_MARGIN_TARGET_PCT,
  countByQuadrant,
  type BcgQuadrant,
  type CmvGapKind,
  type CmvPeriodFilter,
  type CmvProductRow,
  type CmvSortMode,
  type CmvViewMode,
  type ProductCmvMeta,
} from "@/lib/cmvMargensResumo";
import { formatBrl } from "@/lib/dre/formatBrl";
import { supabase } from "@/lib/supabase";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import { cn } from "@/lib/utils";
import { getResumoRanges, normalizeWeekStartsOn } from "@/lib/vendasRealizadasResumo";
import type { RevenueEntry } from "@/types/revenue";
import {
  ExternalLink,
  LayoutGrid,
  Loader2,
  Percent,
  Table2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  ReferenceLine,
} from "recharts";

const PERIOD_OPTIONS: { value: CmvPeriodFilter; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "last7", label: "Esta semana" },
  { value: "month", label: "Este mês" },
];

const SORT_OPTIONS: { value: CmvSortMode; label: string }[] = [
  { value: "melhor", label: "Melhor margem" },
  { value: "pior", label: "Pior margem" },
  { value: "volume", label: "Volume" },
];

const VIEW_OPTIONS: { value: CmvViewMode; label: string; icon: typeof Table2 }[] =
  [
    { value: "tabela", label: "Tabela", icon: Table2 },
    { value: "bcg", label: "Matriz BCG", icon: LayoutGrid },
  ];

type PageTab = "margem" | "qualidade";

const QUADRANT_COLORS: Record<BcgQuadrant, string> = {
  estrela: "#059669",
  vaca: "#2563eb",
  aposta: "#7c3aed",
  abacaxi: "#64748b",
};

const GAP_KIND_LABELS: Record<CmvGapKind, string> = {
  backfill: "Backfill",
  no_cost: "Sem custo",
  recipe: "Ficha",
};

function formatPct(value: number | null, digits = 0): string {
  if (value == null) return "—";
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

function formatMarkup(value: number | null): string {
  if (value == null) return "—";
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}x`;
}

function formatDeltaPp(value: number | null): string {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} pp`;
}

function marginToneClass(marginPct: number | null): string {
  if (marginPct == null) return "text-muted-foreground";
  if (marginPct >= 60) return "text-emerald-600";
  if (marginPct >= CMV_MARGIN_TARGET_PCT) return "text-amber-600";
  return "text-red-600";
}

type BcgTooltipPayload = {
  label?: string;
  quadrant?: BcgQuadrant;
  quantity?: number;
  marginPct?: number | null;
  marginDeltaPp?: number | null;
  revenue?: number;
};

function BcgScatterTooltip({
  active,
  payload,
  compare,
}: {
  active?: boolean;
  payload?: Array<{ payload?: BcgTooltipPayload }>;
  compare?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row?.label) return null;
  const quadrantLabel = row.quadrant
    ? BCG_QUADRANT_LABELS[row.quadrant]
    : null;

  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm shadow-md">
      <p className="font-semibold text-popover-foreground">{row.label}</p>
      {quadrantLabel ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{quadrantLabel}</p>
      ) : null}
      <div className="mt-2 space-y-0.5 text-xs tabular-nums text-muted-foreground">
        <p>
          Volume:{" "}
          {(row.quantity ?? 0).toLocaleString("pt-BR", {
            maximumFractionDigits: 2,
          })}
        </p>
        <p>Margem: {formatPct(row.marginPct ?? null, 1)}</p>
        {compare ? <p>Δ vs ant.: {formatDeltaPp(row.marginDeltaPp ?? null)}</p> : null}
        <p>Receita: {formatBrl(row.revenue ?? 0)}</p>
      </div>
    </div>
  );
}

const QUADRANT_FILTER_OPTIONS: Array<{
  value: BcgQuadrant | "all";
  label: string;
}> = [
  { value: "all", label: "Todos" },
  { value: "estrela", label: "Estrela" },
  { value: "vaca", label: "Vaca" },
  { value: "aposta", label: "Aposta" },
  { value: "abacaxi", label: "Abacaxi" },
];

function KpiCard({
  label,
  value,
  hint,
  valueClassName,
}: {
  label: string;
  value: string;
  hint?: string;
  valueClassName?: string;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="space-y-2 p-4 sm:p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className={cn(
            "text-2xl font-bold tracking-tight tabular-nums text-foreground sm:text-[1.65rem]",
            valueClassName,
          )}
        >
          {value}
        </p>
        {hint ? (
          <p className="text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function CmvMargens({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;

  const [pageTab, setPageTab] = useState<PageTab>("margem");
  const [period, setPeriod] = useState<CmvPeriodFilter>("last7");
  const [sort, setSort] = useState<CmvSortMode>("melhor");
  const [view, setView] = useState<CmvViewMode>("tabela");
  const [compare, setCompare] = useState(false);

  const [entries, setEntries] = useState<RevenueEntry[]>([]);
  const [productNameById, setProductNameById] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [recipeNameById, setRecipeNameById] = useState<Map<string, string>>(
    () => new Map(),
  );
  const [productMetaById, setProductMetaById] = useState<
    Map<string, ProductCmvMeta>
  >(() => new Map());
  const [loading, setLoading] = useState(true);

  const todayYmd = localDateYmd();
  const weekStartsOn = normalizeWeekStartsOn(
    currentCompany?.accounting_week_starts_on,
  );

  const fetchData = useCallback(async () => {
    if (!companyId) {
      setEntries([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { fetchStart, fetchEnd } = getResumoRanges(
        period,
        localDateYmd(),
        null,
        { weekStartsOn },
      );

      const revenueRows = await fetchAllInRange<RevenueEntry>(
        supabase
          .from("revenue_entries")
          .select("*")
          .eq("company_id", companyId)
          .gte("entry_date", fetchStart)
          .lte("entry_date", fetchEnd)
          .order("entry_date", { ascending: true }),
      );

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

      // Também puxa product_id das cmv_lines para meta de composes_cmv
      const cmvProductIds = new Set<string>(productIds);
      for (const row of revenueRows) {
        const lines = Array.isArray(row.cmv_lines) ? row.cmv_lines : [];
        for (const line of lines) {
          if (line && typeof line === "object" && "product_id" in line) {
            const id = String((line as { product_id: unknown }).product_id ?? "");
            if (id) cmvProductIds.add(id);
          }
        }
      }

      const allProductIds = [...cmvProductIds];

      const [productsRes, recipesRes] = await Promise.all([
        allProductIds.length
          ? supabase
              .from("products")
              .select("id, name, composes_cmv, average_cost")
              .in("id", allProductIds)
          : Promise.resolve({ data: [], error: null }),
        recipeIds.length
          ? supabase.from("recipes").select("id, name").in("id", recipeIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (productsRes.error) throw productsRes.error;
      if (recipesRes.error) throw recipesRes.error;

      const products =
        (productsRes.data as {
          id: string;
          name: string;
          composes_cmv?: boolean | null;
          average_cost?: number | null;
        }[]) ?? [];

      setEntries(revenueRows);
      setProductNameById(new Map(products.map((p) => [p.id, p.name])));
      setProductMetaById(
        new Map(
          products.map((p) => [
            p.id,
            {
              composes_cmv: p.composes_cmv,
              average_cost: p.average_cost,
            },
          ]),
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
  }, [companyId, period, weekStartsOn]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const dashboard = useMemo(
    () =>
      buildCmvMargensDashboard({
        entries,
        period,
        todayYmd,
        sort,
        productNameById,
        recipeNameById,
        productMetaById,
        weekStartsOn,
      }),
    [
      entries,
      period,
      todayYmd,
      sort,
      productNameById,
      recipeNameById,
      productMetaById,
      weekStartsOn,
    ],
  );

  const bcgData = useMemo(
    () =>
      dashboard.products.map((p) => ({
        ...p,
        x: p.quantity,
        y: p.marginPct ?? 0,
        z: Math.max(p.revenue, 1),
        fill: QUADRANT_COLORS[p.quadrant],
      })),
    [dashboard.products],
  );

  const tabToggle = (
    <div
      className="inline-flex max-w-full flex-wrap rounded-full bg-muted p-1"
      role="tablist"
      aria-label="Seção CMV e margens"
    >
      {(
        [
          { value: "margem" as const, label: "Margem por produto" },
          { value: "qualidade" as const, label: "Qualidade do CMV" },
        ] as const
      ).map((opt) => {
        const active = pageTab === opt.value;
        return (
          <Button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            variant="ghost"
            size="sm"
            onClick={() => setPageTab(opt.value)}
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
  );

  const body = (
      <div className="space-y-4">
        {embedded ? tabToggle : null}
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Período"
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
            Carregando CMV e margens…
          </div>
        ) : pageTab === "qualidade" ? (
          <QualidadePanel dashboard={dashboard} />
        ) : (
          <MargemPanel
            dashboard={dashboard}
            view={view}
            setView={setView}
            sort={sort}
            setSort={setSort}
            compare={compare}
            setCompare={setCompare}
            bcgData={bcgData}
          />
        )}
      </div>
  );

  if (embedded) {
    return body;
  }

  return (
    <PageShell>
      <PageHeader
        title="CMV & Margens"
        description="Custo, markup e margem por produto — e lacunas de CMV"
        icon={Percent}
        action={tabToggle}
      />
      {body}
    </PageShell>
  );
}

function MargemPanel({
  dashboard,
  view,
  setView,
  sort,
  setSort,
  compare,
  setCompare,
  bcgData,
}: {
  dashboard: ReturnType<typeof buildCmvMargensDashboard>;
  view: CmvViewMode;
  setView: (v: CmvViewMode) => void;
  sort: CmvSortMode;
  setSort: (s: CmvSortMode) => void;
  compare: boolean;
  setCompare: (v: boolean) => void;
  bcgData: Array<
    CmvProductRow & {
      x: number;
      y: number;
      z: number;
      fill: string;
    }
  >;
}) {
  const { kpis, products, insight, volumeThreshold, marginThreshold, ranges } =
    dashboard;
  const [quadrantFilter, setQuadrantFilter] = useState<BcgQuadrant | "all">(
    "all",
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const quadrantCounts = useMemo(() => countByQuadrant(products), [products]);

  const filteredProducts = useMemo(
    () =>
      quadrantFilter === "all"
        ? products
        : products.filter((p) => p.quadrant === quadrantFilter),
    [products, quadrantFilter],
  );

  const filteredBcgData = useMemo(
    () =>
      quadrantFilter === "all"
        ? bcgData
        : bcgData.filter((p) => p.quadrant === quadrantFilter),
    [bcgData, quadrantFilter],
  );

  const labelKeys = useMemo(() => {
    const top = [...filteredBcgData]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8)
      .map((p) => p.key);
    return new Set(top);
  }, [filteredBcgData]);

  const selectedProduct =
    filteredProducts.find((p) => p.key === selectedKey) ??
    products.find((p) => p.key === selectedKey) ??
    null;

  const hasProducts = products.length > 0;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          label="CMV médio"
          value={formatPct(kpis.cmvPct, 0)}
          hint={
            kpis.cmvPct != null && kpis.cmvPct <= 45
              ? "Dentro do ideal"
              : "Sobre a receita líquida"
          }
          valueClassName={
            kpis.cmvPct != null && kpis.cmvPct <= 45
              ? "text-emerald-600"
              : undefined
          }
        />
        <KpiCard
          label="Margem média"
          value={formatPct(kpis.marginPct, 0)}
          hint={
            kpis.belowTargetCount > 0
              ? `${kpis.belowTargetCount} abaixo da meta (${CMV_MARGIN_TARGET_PCT}%)`
              : `Meta ${CMV_MARGIN_TARGET_PCT}%`
          }
          valueClassName={marginToneClass(kpis.marginPct)}
        />
        <KpiCard
          label="Faturamento conciliado"
          value={formatPct(kpis.reconciledPct, 0)}
          hint={
            kpis.pendingGapCount > 0
              ? `${kpis.pendingGapCount} itens a revisar`
              : "CMV válido nas vendas elegíveis"
          }
        />
      </div>

      {insight ? <FaroTipBand>{insight}</FaroTipBand> : null}

      <div className="flex flex-wrap items-center gap-3">
        <div
          className="inline-flex max-w-full flex-wrap rounded-full bg-muted p-1"
          role="tablist"
          aria-label="Visão da margem"
        >
          {VIEW_OPTIONS.map((opt) => {
            const active = view === opt.value;
            const Icon = opt.icon;
            return (
              <Button
                key={opt.value}
                type="button"
                role="tab"
                aria-selected={active}
                variant="ghost"
                size="sm"
                onClick={() => setView(opt.value)}
                className={cn(
                  "h-8 rounded-full px-3 text-sm font-medium shadow-none",
                  active
                    ? "bg-background text-foreground shadow-sm hover:bg-background"
                    : "text-muted-foreground hover:bg-transparent hover:text-foreground",
                )}
              >
                <Icon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                {opt.label}
              </Button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Ordenar
          </span>
          <div className="inline-flex flex-wrap rounded-full border bg-background p-0.5">
            {SORT_OPTIONS.map((opt) => {
              const active = sort === opt.value;
              return (
                <Button
                  key={opt.value}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSort(opt.value)}
                  className={cn(
                    "h-7 rounded-full px-2.5 text-xs font-medium shadow-none",
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {opt.label}
                </Button>
              );
            })}
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Switch checked={compare} onCheckedChange={setCompare} />
          <span>Comparar com período anterior</span>
        </label>
      </div>

      {hasProducts ? (
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Filtrar por quadrante BCG"
        >
          {QUADRANT_FILTER_OPTIONS.map((opt) => {
            const active = quadrantFilter === opt.value;
            const count =
              opt.value === "all"
                ? products.length
                : quadrantCounts[opt.value];
            const color =
              opt.value === "all" ? undefined : QUADRANT_COLORS[opt.value];
            return (
              <Button
                key={opt.value}
                type="button"
                variant={active ? "default" : "outline"}
                size="sm"
                onClick={() => setQuadrantFilter(opt.value)}
                className={cn(
                  "h-8 rounded-full px-3 text-xs font-medium",
                  active
                    ? "bg-foreground text-background hover:bg-foreground/90 hover:text-background"
                    : "bg-background",
                )}
              >
                {color ? (
                  <span
                    className="mr-1.5 h-2 w-2 rounded-full"
                    style={{ backgroundColor: color }}
                    aria-hidden
                  />
                ) : null}
                {opt.label} ({count})
              </Button>
            );
          })}
        </div>
      ) : null}

      {!hasProducts ? (
        <Card className="shadow-sm">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Nenhuma venda de produto ou receita neste período.
          </CardContent>
        </Card>
      ) : view === "bcg" ? (
        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">
              Matriz BCG · volume × margem
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Limiar de volume:{" "}
              {volumeThreshold.toLocaleString("pt-BR", {
                maximumFractionDigits: 1,
              })}{" "}
              · margem {marginThreshold}% · {ranges.championsTitle}
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="mb-3 flex flex-wrap gap-3 text-xs">
              {(Object.keys(QUADRANT_COLORS) as BcgQuadrant[]).map((q) => (
                <span key={q} className="inline-flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: QUADRANT_COLORS[q] }}
                  />
                  {BCG_QUADRANT_LABELS[q]}
                </span>
              ))}
            </div>
            {filteredBcgData.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Nenhum produto neste quadrante.
              </p>
            ) : (
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart
                    margin={{ top: 12, right: 16, bottom: 12, left: 8 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-border"
                    />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name="Volume"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      label={{
                        value: "Volume de vendas →",
                        position: "insideBottom",
                        offset: -4,
                        fontSize: 11,
                      }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name="Margem"
                      unit="%"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      domain={[0, "auto"]}
                      label={{
                        value: "Margem % →",
                        angle: -90,
                        position: "insideLeft",
                        fontSize: 11,
                      }}
                    />
                    <ZAxis type="number" dataKey="z" range={[60, 400]} />
                    <ReferenceLine
                      x={volumeThreshold}
                      stroke="var(--border)"
                      strokeDasharray="4 4"
                    />
                    <ReferenceLine
                      y={marginThreshold}
                      stroke="var(--border)"
                      strokeDasharray="4 4"
                    />
                    <Tooltip
                      cursor={{ strokeDasharray: "3 3" }}
                      content={<BcgScatterTooltip compare={compare} />}
                    />
                    <Scatter
                      data={filteredBcgData}
                      name="Produtos"
                      cursor="pointer"
                      onClick={(data) => {
                        const row = data as
                          | { key?: string; payload?: { key?: string } }
                          | undefined;
                        const key = row?.key ?? row?.payload?.key;
                        if (key) setSelectedKey(key);
                      }}
                    >
                      {filteredBcgData.map((entry) => (
                        <Cell key={entry.key} fill={entry.fill} />
                      ))}
                      <LabelList
                        dataKey="shortLabel"
                        position="top"
                        className="fill-foreground"
                        style={{ fontSize: 10 }}
                        content={(props) => {
                          const { x, y, index } = props as {
                            x?: number | string;
                            y?: number | string;
                            index?: number;
                          };
                          const row =
                            typeof index === "number"
                              ? filteredBcgData[index]
                              : undefined;
                          if (
                            !row ||
                            !labelKeys.has(row.key) ||
                            x == null ||
                            y == null
                          ) {
                            return null;
                          }
                          return (
                            <text
                              x={Number(x)}
                              y={Number(y) - 10}
                              textAnchor="middle"
                              className="fill-muted-foreground"
                              style={{ fontSize: 10 }}
                            >
                              {row.shortLabel}
                            </text>
                          );
                        }}
                      />
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Margem por produto — {ranges.championsTitle}
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto pt-0">
            {filteredProducts.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Nenhum produto neste quadrante.
              </p>
            ) : (
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-3 font-semibold">Produto</th>
                    <th className="pb-2 pr-3 text-right font-semibold">
                      Preço compra
                    </th>
                    <th className="pb-2 pr-3 text-right font-semibold">
                      Preço venda
                    </th>
                    <th className="pb-2 pr-3 text-right font-semibold">Markup</th>
                    <th className="pb-2 pr-3 text-right font-semibold">Margem</th>
                    {compare ? (
                      <th className="pb-2 text-right font-semibold">vs ant.</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((row) => (
                    <tr
                      key={row.key}
                      className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/40"
                      onClick={() => setSelectedKey(row.key)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedKey(row.key);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                    >
                      <td className="py-3 pr-3">
                        <div className="flex items-start gap-2">
                          <span
                            className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{
                              backgroundColor: QUADRANT_COLORS[row.quadrant],
                            }}
                            aria-hidden
                          />
                          <div>
                            <div className="font-medium text-foreground">
                              {row.label}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {row.quantity.toLocaleString("pt-BR", {
                                maximumFractionDigits: 2,
                              })}{" "}
                              un · {BCG_QUADRANT_LABELS[row.quadrant]}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 pr-3 text-right tabular-nums">
                        {formatBrl(row.costPrice)}
                      </td>
                      <td className="py-3 pr-3 text-right tabular-nums">
                        {formatBrl(row.sellPrice)}
                      </td>
                      <td className="py-3 pr-3 text-right tabular-nums">
                        {formatMarkup(row.markup)}
                      </td>
                      <td className="py-3 pr-3">
                        <div className="flex items-center justify-end gap-2">
                          <div className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-muted sm:block">
                            <div
                              className="h-full rounded-full bg-current opacity-70"
                              style={{
                                width: `${Math.min(100, Math.max(0, row.marginPct ?? 0))}%`,
                              }}
                            />
                          </div>
                          <span
                            className={cn(
                              "tabular-nums font-medium",
                              marginToneClass(row.marginPct),
                            )}
                          >
                            {formatPct(row.marginPct, 0)}
                          </span>
                        </div>
                      </td>
                      {compare ? (
                        <td
                          className={cn(
                            "py-3 text-right tabular-nums text-xs font-medium",
                            row.marginDeltaPp != null &&
                              row.marginDeltaPp > 0 &&
                              "text-emerald-600",
                            row.marginDeltaPp != null &&
                              row.marginDeltaPp < 0 &&
                              "text-red-600",
                            (row.marginDeltaPp == null ||
                              row.marginDeltaPp === 0) &&
                              "text-muted-foreground",
                          )}
                        >
                          {formatDeltaPp(row.marginDeltaPp)}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      <CmvProductDetailSheet
        product={selectedProduct}
        open={selectedKey != null}
        onOpenChange={(open) => {
          if (!open) setSelectedKey(null);
        }}
        compare={compare}
      />
    </>
  );
}

function gapCta(gap: {
  productId: string | null;
  recipeId: string | null;
}): { to: string; label: string } {
  if (gap.productId) {
    return {
      to: `/app/produtos?highlight=${encodeURIComponent(gap.productId)}`,
      label: "Abrir produto",
    };
  }
  if (gap.recipeId) {
    return {
      to: "/app/produtos?estoque=receitas",
      label: "Abrir ficha",
    };
  }
  return { to: "/app/produtos", label: "Abrir produtos" };
}

function QualidadePanel({
  dashboard,
}: {
  dashboard: ReturnType<typeof buildCmvMargensDashboard>;
}) {
  const { kpis, gaps, ranges } = dashboard;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <KpiCard
          label="Faturamento conciliado"
          value={formatPct(kpis.reconciledPct, 0)}
          hint={`${formatBrl(kpis.reconciledRevenue)} de ${formatBrl(kpis.eligibleRevenue)}`}
        />
        <KpiCard
          label="Itens pendentes"
          value={String(kpis.pendingGapCount)}
          hint={`Período: ${ranges.championsTitle}`}
        />
        <KpiCard
          label="CMV médio"
          value={formatPct(kpis.cmvPct, 0)}
          hint="Sobre a receita líquida do período"
        />
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Lacunas de CMV — {ranges.championsTitle}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Vendas elegíveis sem custo válido. Corrija o cadastro do produto ou a
            ficha técnica para o CMV passar a refletir nas margens.
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          {gaps.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              100% conciliado neste período. As margens estão confiáveis.
            </p>
          ) : (
            <ul className="divide-y divide-border/70">
              {gaps.map((gap) => {
                const cta = gapCta(gap);
                return (
                  <li
                    key={gap.key}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {GAP_KIND_LABELS[gap.kind]}
                        </span>
                        <span className="font-medium text-foreground">
                          {gap.label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{gap.hint}</p>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {gap.count.toLocaleString("pt-BR")} venda(s) ·{" "}
                        {formatBrl(gap.revenue)} ·{" "}
                        {(gap.weight * 100).toLocaleString("pt-BR", {
                          maximumFractionDigits: 0,
                        })}
                        % do elegível
                      </p>
                    </div>
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                    >
                      <Link to={cta.to}>
                        {cta.label}
                        <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

import { type MonthYear } from "@/components/MonthSelector";
import { ReferencePeriodCard } from "@/components/ReferencePeriodCard";
import {
  DreExpandableLine,
  DreHighlightBlock,
} from "@/components/dre/DreExpandableLine";
import { DreEvolutionChart } from "@/components/dre/DreEvolutionChart";
import { DreOwnerSummary } from "@/components/dre/DreOwnerSummary";
import { DreSemCategoriaTable } from "@/components/dre/DreSemCategoriaTable";
import { DreTreePanel } from "@/components/dre/DreTreePanel";
import { DreWaterfallChart } from "@/components/dre/DreWaterfallChart";
import { Button } from "@/components/ui/button";
import {
  MonthClosingChecklist,
  MonthClosingChecklistButton,
} from "@/components/monthClosing/MonthClosingChecklist";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useDreReport } from "@/hooks/useDreReport";
import { useMonthClosingChecklist } from "@/hooks/useMonthClosingChecklist";
import type { DreComputed } from "@/lib/dre/computeDre";
import {
  projectMonthEndLucro,
  shiftMonth,
} from "@/lib/dre/dreInsight";
import {
  margemContribuicao,
  pontoEquilibrioReceita,
  porCemReaisVendasLiquidas,
  taxaMargemContribuicao,
} from "@/lib/dre/dreIndicators";
import { buildExpenseMix } from "@/lib/dre/expenseMix";
import {
  fetchDreHistory,
  type DreHistoryPoint,
} from "@/lib/dre/fetchDreHistory";
import { formatBrl } from "@/lib/dre/formatBrl";
import type { DreTreeNode } from "@/lib/dre/dreTree";
import { buildDreTreeForBucket } from "@/lib/dre/dreTree";
import { ptBrUi } from "@/lib/ptBrUiStrings";
import { cn } from "@/lib/utils";
import { OrcamentoPanel } from "@/pages/Orcamento";
import {
  AlertTriangle,
  BarChart3,
  ChevronDown,
  Coins,
  ListX,
  PieChart,
  Scale,
  Target,
  TrendingUp,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

type DrePageTab = "resultado" | "orcamento";
type DreMainView = "resumo" | "cascata" | "contador" | "sem-categoria";

function parseDrePageTab(raw: string | null): DrePageTab {
  return raw === "orcamento" ? "orcamento" : "resultado";
}

function parseDreMainView(raw: string | null): DreMainView {
  if (raw === "cascata" || raw === "contador" || raw === "sem-categoria") {
    return raw;
  }
  return "resumo";
}

export function Dre() {
  const { user } = useAuth();
  const { currentCompany } = useCompany();
  const [searchParams, setSearchParams] = useSearchParams();
  const now = new Date();
  const [period, setPeriod] = useState<MonthYear>({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  });
  const [checklistOpen, setChecklistOpen] = useState(false);
  const pageTab = parseDrePageTab(searchParams.get("tab"));
  const [mainView, setMainView] = useState<DreMainView>(() =>
    parseDreMainView(searchParams.get("view")),
  );
  const [history, setHistory] = useState<DreHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const {
    loading,
    error,
    categories,
    boletosSemCategoria,
    boletosInPeriod,
    categoryTotals,
    computed,
    salesCmvInPeriod,
    periodLabel,
    hasMappedMovement,
    hasOnlyUnclassified,
    reload,
  } = useDreReport(currentCompany?.id, period, {
    enabled: pageTab === "resultado",
  });

  const prevPeriod = useMemo(() => shiftMonth(period, -1), [period]);
  const prevReport = useDreReport(currentCompany?.id, prevPeriod, {
    enabled: pageTab === "resultado",
  });

  const categoriesById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const monthClosing = useMonthClosingChecklist(
    currentCompany?.id,
    period,
    computed,
    categoryTotals,
    categories,
    user?.email ?? null,
  );

  const trees = useMemo(() => {
    if (!categories.length || !computed) return null;
    const m = categoryTotals.byCategoryId;
    return {
      brutas: buildDreTreeForBucket(categories, m, "VENDAS_BRUTAS"),
      deducoes: buildDreTreeForBucket(categories, m, "DEDUCAO_RECEITA"),
      cmv: buildDreTreeForBucket(categories, m, "CMV"),
      var: buildDreTreeForBucket(categories, m, "DESPESAS_VARIAVEIS"),
      fix: buildDreTreeForBucket(categories, m, "DESPESAS_FIXAS"),
      finRec: buildDreTreeForBucket(categories, m, "RESULTADO_FINANCEIRO_RECEITA"),
      finDesp: buildDreTreeForBucket(categories, m, "RESULTADO_FINANCEIRO_DESPESA"),
      imp: buildDreTreeForBucket(categories, m, "IMPOSTOS"),
    };
  }, [categories, categoryTotals.byCategoryId, computed]);

  const cmvTree: DreTreeNode[] = useMemo(() => {
    const base = trees?.cmv ?? [];
    if (salesCmvInPeriod <= 0) return base;
    return [
      ...base,
      {
        id: "__sales_cmv__",
        name: "CMV de vendas (fichas)",
        amount: salesCmvInPeriod,
        children: [],
      },
    ];
  }, [trees?.cmv, salesCmvInPeriod]);

  const expenseMix = useMemo(
    () => buildExpenseMix(categories, categoryTotals.byCategoryId, 5),
    [categories, categoryTotals.byCategoryId],
  );

  useEffect(() => {
    if (!currentCompany?.id || categories.length === 0 || pageTab === "orcamento") {
      setHistory([]);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    void fetchDreHistory(currentCompany.id, categories, period, 6)
      .then((points) => {
        if (!cancelled) setHistory(points);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentCompany?.id, categories, period.month, period.year, pageTab]);

  const projection = useMemo(() => {
    if (!computed) return null;
    return projectMonthEndLucro(computed.lucroLiquido, period);
  }, [computed, period]);

  useEffect(() => {
    const raw = searchParams.get("view");
    if (raw) setMainView(parseDreMainView(raw));
  }, [searchParams]);

  const setPageTab = (next: DrePageTab) => {
    const nextParams = new URLSearchParams(searchParams);
    if (next === "resultado") nextParams.delete("tab");
    else nextParams.set("tab", next);
    if (next === "orcamento") {
      nextParams.delete("view");
      nextParams.delete("from");
    }
    setSearchParams(nextParams, { replace: true });
  };

  const showUnclassifiedBanner =
    !loading &&
    (categoryTotals.semCategoriaCount > 0 ||
      categoryTotals.unmappedCategoryIds.size > 0) &&
    (mainView === "resumo" || mainView === "cascata" || mainView === "contador");

  return (
    <PageShell>
      <PageHeader
        title={pageTab === "orcamento" ? "Orçamento" : "Resultado"}
        description={
          pageTab === "orcamento"
            ? "Meta de custo por categoria versus o que já foi gasto no mês — não é o lucro do DRE."
            : "Quanto sobrou no período — por vencimento dos lançamentos (competência)."
        }
        icon={pageTab === "orcamento" ? Target : BarChart3}
      />

      <div
        className="mb-6 inline-flex max-w-full flex-wrap rounded-full bg-muted p-1"
        role="tablist"
        aria-label="Visão de resultado"
      >
        {(
          [
            { value: "resultado" as const, label: "Resultado", icon: BarChart3 },
            { value: "orcamento" as const, label: "Orçamento", icon: Target },
          ] as const
        ).map((opt) => {
          const active = pageTab === opt.value;
          const Icon = opt.icon;
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
                  ? "bg-ring text-foreground shadow-sm hover:!bg-ring/80"
                  : "text-muted-foreground hover:bg-ring hover:text-foreground",
              )}
            >
              <Icon className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              {opt.label}
            </Button>
          );
        })}
      </div>

      {pageTab === "orcamento" ? (
        <OrcamentoPanel period={period} onPeriodChange={setPeriod} />
      ) : (
        <>

      <Accordion type="single" collapsible className="mb-4">
        <AccordionItem value="como-conta" className="border-border/60">
          <AccordionTrigger className="py-2 text-sm text-muted-foreground hover:no-underline">
            Como o DRE conta
          </AccordionTrigger>
          <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
            {ptBrUi.dre.regrasClassificacao} Lançamentos sem categoria do plano{" "}
            <strong className="text-foreground">não entram</strong> nas linhas do
            resultado até serem classificados.
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="mb-6 flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex min-w-0 flex-1 justify-start">
          <ReferencePeriodCard
            className="max-w-full border-primary/30"
            value={period}
            onChange={setPeriod}
            description="Totais usam o vencimento (due_date) neste mês"
          />
        </div>
        <MonthClosingChecklistButton
          className="w-full shrink-0 sm:w-auto sm:self-center"
          isClosed={monthClosing.isClosed}
          loading={loading || !monthClosing.hydrated}
          onClick={() => setChecklistOpen(true)}
        />
      </div>

      <MonthClosingChecklist
        open={checklistOpen}
        onOpenChange={setChecklistOpen}
        periodLabel={periodLabel}
        loading={loading}
        hydrated={monthClosing.hydrated}
        isClosed={monthClosing.isClosed}
        closedAt={monthClosing.closedAt}
        closedBy={monthClosing.closedBy}
        reopenReason={monthClosing.reopenReason}
        doneCount={monthClosing.doneCount}
        canClose={monthClosing.canClose}
        items={monthClosing.items}
        onConfirmValue={monthClosing.confirmValue}
        onConfirmNoValue={monthClosing.confirmNoValue}
        onUndo={monthClosing.undoItem}
        onCloseMonth={monthClosing.closeMonth}
        onReopenMonth={monthClosing.reopenMonth}
      />

      {error ? (
        <div
          role="alert"
          className="mb-6 flex gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-destructive">Erro ao carregar</p>
            <p className="text-muted-foreground">{error}</p>
          </div>
        </div>
      ) : null}

      {showUnclassifiedBanner ? (
        <div
          role="status"
          className="mb-6 flex flex-wrap items-start gap-3 rounded-lg border border-orange-300/70 bg-orange-50/70 px-4 py-3 text-sm dark:border-orange-500/40 dark:bg-orange-500/10"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-300" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">Atenção</p>
            <div className="text-muted-foreground">
              {categoryTotals.semCategoriaCount > 0 ? (
                <p>
                  Existem {categoryTotals.semCategoriaCount} lançamento(s) sem
                  categoria no período (total{" "}
                  {formatBrl(categoryTotals.semCategoriaTotal)}) — não entram no
                  resultado classificado.{" "}
                  <button
                    type="button"
                    className="font-medium text-orange-800 underline underline-offset-2 hover:no-underline dark:text-orange-200"
                    onClick={() => setMainView("sem-categoria")}
                  >
                    Classificar agora
                  </button>
                </p>
              ) : null}
              {categoryTotals.unmappedCategoryIds.size > 0 ? (
                <p>
                  {categoryTotals.unmappedCategoryIds.size} categoria(s) fora do
                  plano DRE
                  {categoryTotals.unmappedTotal > 0
                    ? ` (${formatBrl(categoryTotals.unmappedTotal)})`
                    : ""}
                  .
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div
        className="mb-4 inline-flex max-w-full flex-wrap rounded-full bg-muted p-1"
        role="tablist"
        aria-label="Visualização do resultado"
      >
        {(
          [
            { id: "resumo" as const, label: "Resumo", icon: PieChart },
            { id: "cascata" as const, label: "Cascata", icon: TrendingUp },
            { id: "contador" as const, label: "Modo contador", icon: BarChart3 },
            {
              id: "sem-categoria" as const,
              label: "Sem categoria",
              icon: ListX,
              badge: categoryTotals.semCategoriaCount,
            },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = mainView === tab.id;
          return (
            <Button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              variant="ghost"
              size="sm"
              onClick={() => setMainView(tab.id)}
              className={cn(
                "rounded-full px-3 sm:px-4",
                active && "bg-background shadow-sm",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{tab.label}</span>
              {"badge" in tab && tab.badge && tab.badge > 0 ? (
                <span className="rounded-full bg-orange-500/15 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-orange-800 dark:text-orange-200">
                  {tab.badge}
                </span>
              ) : null}
            </Button>
          );
        })}
      </div>

      {mainView === "resumo" ? (
        loading ? (
          <div className="space-y-4">
            <Skeleton className="h-20 w-full rounded-xl" />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Skeleton className="h-72 w-full rounded-xl" />
              <Skeleton className="h-72 w-full rounded-xl" />
            </div>
          </div>
        ) : hasOnlyUnclassified ? (
          <Card className="border-amber-500/40 bg-amber-500/5 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                Há movimento, mas nada classificado
              </CardTitle>
              <CardDescription>
                {boletosInPeriod.length} lançamento(s) vencem em {periodLabel}, porém
                nenhum tem categoria do plano — por isso o resultado aparece zerado.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button type="button" onClick={() => setMainView("sem-categoria")}>
                Classificar lançamentos
              </Button>
            </CardContent>
          </Card>
        ) : !computed || (!hasMappedMovement && categoryTotals.semCategoriaCount === 0) ? (
          <Card className="border-border/80 shadow-sm">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              Sem movimento neste período. Quando houver vendas e despesas
              classificadas, o resultado aparece aqui.
            </CardContent>
          </Card>
        ) : computed ? (
          <DreOwnerSummary
            computed={computed}
            period={period}
            periodLabel={periodLabel}
            previous={prevReport.computed}
            expenseMix={expenseMix}
            semCategoriaTotal={categoryTotals.semCategoriaTotal}
            onClassifyClick={() => setMainView("sem-categoria")}
          />
        ) : null
      ) : null}

      {mainView === "cascata" ? (
        <div className="space-y-4">
          {hasOnlyUnclassified ? (
            <Card className="border-amber-500/40 bg-amber-500/5 shadow-sm">
              <CardContent className="flex flex-col gap-3 py-6 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Classifique os lançamentos para montar a cascata do resultado.
                </p>
                <Button type="button" onClick={() => setMainView("sem-categoria")}>
                  Classificar
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              <DreWaterfallChart
                computed={hasMappedMovement ? computed : null}
                periodLabel={periodLabel}
                loading={loading}
              />
              <DreEvolutionChart
                points={history}
                projection={projection}
                loading={historyLoading || loading}
              />
              {projection && computed ? (
                <Card className="border-border/80 shadow-sm">
                  <CardContent className="flex flex-wrap items-baseline justify-between gap-2 py-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Projeção fim do mês
                      </p>
                      <p className="text-2xl font-bold tabular-nums text-primary">
                        {formatBrl(projection.projected)}
                      </p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Estimativa linear com base no lucro até hoje · faltam{" "}
                      {projection.daysLeft} dia(s)
                    </p>
                  </CardContent>
                </Card>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {mainView === "contador" ? (
        <>
          {loading ? (
            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
              <Skeleton className="h-56 w-full rounded-lg" />
              <Skeleton className="h-56 w-full rounded-lg" />
              <Skeleton className="h-56 w-full rounded-lg" />
            </div>
          ) : computed && hasMappedMovement ? (
            <DreKpiGrid computed={computed} className="mb-6" />
          ) : null}

          <Card className="border-border/80 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">DRE detalhado</CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                {ptBrUi.dre.resumoAnaliticoDesc}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-0 pt-0">
              {loading ? (
                <div className="space-y-3 py-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : hasOnlyUnclassified ? (
                <div className="py-8 text-center">
                  <p className="mb-4 text-sm text-muted-foreground">
                    Não há linhas classificadas — classifique os lançamentos
                    primeiro.
                  </p>
                  <Button type="button" onClick={() => setMainView("sem-categoria")}>
                    Ir para Sem categoria
                  </Button>
                </div>
              ) : !computed ? (
                <p className="py-8 text-sm text-muted-foreground">
                  Sem dados para exibir.
                </p>
              ) : (
                <DreContadorLines
                  computed={computed}
                  trees={trees}
                  cmvTree={cmvTree}
                  semCategoriaTotal={categoryTotals.semCategoriaTotal}
                  onSemCategoria={() => setMainView("sem-categoria")}
                />
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      {mainView === "sem-categoria" ? (
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-lg">Lançamentos sem categoria</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Boletos com vencimento em {periodLabel} sem categoria do plano —
                  fora do resultado classificado do DRE.
                </CardDescription>
              </div>
              {searchParams.get("from") === "orcamento" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setPageTab("orcamento")}
                >
                  <Target className="mr-2 h-4 w-4" />
                  Voltar ao orçamento
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <DreSemCategoriaTable
              rows={boletosSemCategoria}
              totalAmount={categoryTotals.semCategoriaTotal}
              periodLabel={periodLabel}
              loading={loading}
              categoriesById={categoriesById}
              categories={categories}
              companyId={currentCompany?.id}
              onClassified={reload}
            />
          </CardContent>
        </Card>
      ) : null}
        </>
      )}
    </PageShell>
  );
}

function DreContadorLines({
  computed,
  trees,
  cmvTree,
  semCategoriaTotal,
  onSemCategoria,
}: {
  computed: DreComputed;
  trees: {
    brutas: DreTreeNode[];
    deducoes: DreTreeNode[];
    cmv: DreTreeNode[];
    var: DreTreeNode[];
    fix: DreTreeNode[];
    finRec: DreTreeNode[];
    finDesp: DreTreeNode[];
    imp: DreTreeNode[];
  } | null;
  cmvTree: DreTreeNode[];
  semCategoriaTotal: number;
  onSemCategoria: () => void;
}) {
  return (
    <div className="divide-y divide-border/70">
      <DreExpandableLine
        accordionValue="brutas"
        label="Vendas brutas"
        amount={computed.vendasBrutas}
        tone="receita"
        prefix="(+)"
        tree={trees?.brutas ?? []}
      />
      <DreExpandableLine
        accordionValue="deducoes"
        label={ptBrUi.dre.deducoesReceitaLabel}
        amount={-computed.deducoesReceita}
        tone="deducao"
        prefix="(−)"
        tree={trees?.deducoes ?? []}
        treeDisplayNegative
      />

      <div className="py-3">
        <DreHighlightBlock label="Vendas líquidas" amount={computed.vendasLiquidas} />
      </div>

      <DreExpandableLine
        accordionValue="cmv"
        label="CMV"
        amount={-computed.cmv}
        tone="despesa"
        prefix="(−)"
        tree={cmvTree}
        treeDisplayNegative
      />

      <div className="py-3">
        <DreHighlightBlock label="Lucro bruto" amount={computed.lucroBruto} />
      </div>

      <DreExpandableLine
        accordionValue="despesas-var"
        label="Despesas variáveis"
        amount={-computed.despesasVariaveis}
        tone="despesa"
        prefix="(−)"
        tree={trees?.var ?? []}
        treeDisplayNegative
      />
      <DreExpandableLine
        accordionValue="despesas-fix"
        label="Despesas fixas"
        amount={-computed.despesasFixas}
        tone="despesa"
        prefix="(−)"
        tree={trees?.fix ?? []}
        treeDisplayNegative
      />

      <div className="py-3">
        <DreHighlightBlock
          label="Resultado operacional"
          amount={computed.resultadoOperacional}
        />
      </div>

      <Accordion type="single" collapsible>
        <AccordionItem value="fin" className="border-0">
          <AccordionTrigger
            className={cn(
              "hover:no-underline flex w-full min-w-0 items-baseline justify-between gap-3 rounded-md py-2.5 text-left text-sm sm:text-base",
            )}
          >
            <span className="flex min-w-0 flex-1 items-center gap-3 font-medium">
              <span className="w-8 shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
                (+/−)
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="min-w-0 truncate">Resultado financeiro</span>
                <ChevronDown
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/accordion-trigger:rotate-180"
                  aria-hidden
                />
              </span>
            </span>
            <span
              className={cn(
                "shrink-0 text-right tabular-nums text-sm font-semibold sm:text-base",
                computed.resultadoFinanceiroLiquido >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-700 dark:text-rose-400",
              )}
            >
              {formatBrl(computed.resultadoFinanceiroLiquido)}
            </span>
          </AccordionTrigger>
          <AccordionContent className="pl-4 pt-1 sm:pl-8">
            <div className="space-y-4 rounded-md border border-border/60 bg-background/50 p-3 sm:p-4">
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Receitas não operacionais
                </p>
                <DreTreePanel
                  embedded
                  nodes={trees?.finRec ?? []}
                  valueClassName="text-emerald-600 dark:text-emerald-400"
                />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Investimentos e financiamentos
                </p>
                <DreTreePanel
                  embedded
                  nodes={trees?.finDesp ?? []}
                  valueClassName="text-rose-700 dark:text-rose-400"
                  displayNegative
                />
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <div className="py-2">
        <div className="flex min-w-0 items-baseline justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2.5 sm:gap-3 sm:px-4">
          <span className="min-w-0 flex-1 truncate text-xs font-medium leading-snug text-foreground sm:text-sm">
            Resultado antes do imposto sobre o lucro
          </span>
          <span className="shrink-0 text-right tabular-nums text-xs font-semibold text-foreground sm:text-sm">
            {formatBrl(computed.resultadoAntesImposto)}
          </span>
        </div>
      </div>

      <DreExpandableLine
        accordionValue="impostos"
        label="Imposto sobre o lucro"
        amount={-computed.impostos}
        tone="despesa"
        prefix="(−)"
        tree={trees?.imp ?? []}
        treeDisplayNegative
      />

      {semCategoriaTotal > 0 ? (
        <button
          type="button"
          onClick={onSemCategoria}
          className="flex w-full items-baseline justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-left transition-colors hover:bg-amber-500/15"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="w-6 shrink-0 font-mono text-xs text-amber-700 dark:text-amber-300">
              (−)
            </span>
            <span className="min-w-0 truncate font-medium text-amber-900 dark:text-amber-200">
              Sem classificação
            </span>
          </span>
          <span className="shrink-0 tabular-nums font-semibold text-amber-800 dark:text-amber-200">
            − {formatBrl(semCategoriaTotal)}
          </span>
        </button>
      ) : null}

      <div className="py-3">
        <DreHighlightBlock
          label="Lucro líquido"
          amount={computed.lucroLiquido - Math.max(0, semCategoriaTotal)}
        />
        {semCategoriaTotal > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Contábil sem a linha âmbar: {formatBrl(computed.lucroLiquido)}. Com
            sem classificação, o resultado gerencial cai.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function DreKpiGrid({ computed, className }: { computed: DreComputed; className?: string }) {
  const mc = margemContribuicao(computed);
  const pe = pontoEquilibrioReceita(computed);
  const por100 = porCemReaisVendasLiquidas(computed);
  const taxaMc = taxaMargemContribuicao(computed);

  const pctMc = (taxaMc * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  const margemSobreVendasText =
    computed.vendasLiquidas <= 0
      ? "Sem vendas líquidas no período — a taxa de margem não se aplica."
      : mc <= 0
        ? "Neste período a margem sobre a receita líquida foi 0% (custos e despesas variáveis absorveram toda a receita)."
        : `${pctMc}% da receita líquida permanecem como margem de contribuição.`;

  const kpiCardClass = "flex h-full flex-col border-border/80 shadow-sm";

  return (
    <div className={cn("grid grid-cols-1 gap-4 md:grid-cols-3 md:items-stretch", className)}>
      <Card className={kpiCardClass}>
        <CardHeader className="shrink-0 pb-2">
          <div className="flex gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"
              aria-hidden
            >
              <Coins className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <CardTitle className="text-base leading-tight">Sobra das Vendas</CardTitle>
              <CardDescription className="text-xs leading-snug">
                Valor que sobra do faturamento após descontar os custos e despesas variáveis.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col pt-0">
          <ul className="space-y-1.5 text-sm">
            <li className="flex min-w-0 items-baseline justify-between gap-2 tabular-nums">
              <span className="min-w-0 flex-1 text-muted-foreground">Vendas líquidas</span>
              <span className="shrink-0 text-right font-medium">{formatBrl(computed.vendasLiquidas)}</span>
            </li>
            <li className="flex min-w-0 items-baseline justify-between gap-2 tabular-nums">
              <span className="min-w-0 flex-1 text-muted-foreground">CMV</span>
              <span className="shrink-0 text-right font-medium">{formatBrl(computed.cmv)}</span>
            </li>
            <li className="flex min-w-0 items-baseline justify-between gap-2 tabular-nums">
              <span className="min-w-0 flex-1 text-muted-foreground">Despesas variáveis</span>
              <span className="shrink-0 text-right font-medium">
                {formatBrl(computed.despesasVariaveis)}
              </span>
            </li>
            <li className="flex min-w-0 items-baseline justify-between gap-2 border-t border-border/60 pt-1.5 tabular-nums">
              <span className="min-w-0 flex-1 font-medium text-foreground">Sobra das vendas</span>
              <span className="shrink-0 text-right font-semibold text-foreground">{formatBrl(mc)}</span>
            </li>
          </ul>
          <p className="mt-2 text-xs leading-snug text-muted-foreground">{margemSobreVendasText}</p>
        </CardContent>
      </Card>

      <Card className={kpiCardClass}>
        <CardHeader className="shrink-0 pb-2">
          <div className="flex gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"
              aria-hidden
            >
              <Scale className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <CardTitle className="text-base leading-tight">Ponto de Equilíbrio</CardTitle>
              <CardDescription className="text-xs leading-snug">
                Faturamento mínimo para cobrir as despesas fixas.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col pt-0">
          <ul className="space-y-1.5 text-sm">
            <li className="flex min-w-0 items-baseline justify-between gap-2 tabular-nums">
              <span className="min-w-0 flex-1 text-muted-foreground">Despesas fixas</span>
              <span className="shrink-0 text-right font-medium">{formatBrl(computed.despesasFixas)}</span>
            </li>
            <li className="flex min-w-0 items-baseline justify-between gap-2 border-t border-border/60 pt-1.5 tabular-nums">
              <span className="min-w-0 flex-1 font-medium text-foreground">Ponto de equilíbrio</span>
              <span className="shrink-0 text-right font-semibold text-foreground">
                {formatBrl(pe.value)}
              </span>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card className={kpiCardClass}>
        <CardHeader className="shrink-0 pb-2">
          <div className="flex gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"
              aria-hidden
            >
              <PieChart className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <CardTitle className="text-base leading-tight">Para cada R$100,00 vendidos</CardTitle>
              <CardDescription className="text-xs leading-snug">
                Valores em reais por R$100 de vendas líquidas.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col pt-2 md:pt-3">
          <ul className="space-y-1.5 text-sm">
            <li className="flex min-w-0 items-baseline justify-between gap-2 tabular-nums">
              <span className="min-w-0 flex-1 text-muted-foreground">CMV</span>
              <span className="shrink-0 text-right font-medium">{formatBrl(por100.cmv)}</span>
            </li>
            <li className="flex min-w-0 items-baseline justify-between gap-2 tabular-nums">
              <span className="min-w-0 flex-1 font-medium text-foreground">Margem de contribuição</span>
              <span className="shrink-0 text-right font-semibold text-foreground">
                {formatBrl(por100.margemContribuicao)}
              </span>
            </li>
            <li className="flex min-w-0 items-baseline justify-between gap-2 tabular-nums">
              <span className="min-w-0 flex-1 font-medium text-foreground">Resultado operacional</span>
              <span
                className={cn(
                  "shrink-0 text-right font-semibold",
                  por100.resultadoOperacional >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-700 dark:text-rose-400",
                )}
              >
                {formatBrl(por100.resultadoOperacional)}
              </span>
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

import { type MonthYear } from "@/components/MonthSelector";
import { ReferencePeriodCard } from "@/components/ReferencePeriodCard";
import {
  DreExpandableLine,
  DreHighlightBlock,
} from "@/components/dre/DreExpandableLine";
import { DreTreePanel } from "@/components/dre/DreTreePanel";
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
import { useCompany } from "@/contexts/CompanyContext";
import { useDreReport } from "@/hooks/useDreReport";
import { buildDreTreeForBucket } from "@/lib/dre/dreTree";
import { cn } from "@/lib/utils";
import { canGestorAccess } from "@/lib/roles";
import { AlertTriangle, ChevronDown, FileBarChart } from "lucide-react";
import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";

export function Dre() {
  const { currentCompany, currentRole } = useCompany();
  const now = new Date();
  const [period, setPeriod] = useState<MonthYear>({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  });

  const { loading, error, categories, categoryTotals, computed } = useDreReport(
    currentCompany?.id,
    period,
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

  if (!currentRole || !canGestorAccess(currentRole)) {
    return <Navigate to="/app" replace />;
  }

  return (
    <PageShell>
      <PageHeader
        title="DRE"
        description="Demonstração do resultado do exercício por competência (vencimento dos lançamentos)."
        icon={FileBarChart}
      />

      <ReferencePeriodCard
        className="mb-6"
        value={period}
        onChange={setPeriod}
        description="Relatório e totais usam este mês"
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

      {(categoryTotals.semCategoriaCount > 0 || categoryTotals.unmappedCategoryIds.size > 0) &&
      !loading ? (
        <div
          role="status"
          className="mb-6 flex gap-3 rounded-lg border border-orange-300/70 bg-orange-50/70 px-4 py-3 text-sm dark:border-orange-500/40 dark:bg-orange-500/10"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-300" />
          <div>
            <p className="font-medium text-foreground">Atenção</p>
            <div className="text-muted-foreground">
              {categoryTotals.semCategoriaCount > 0 ? (
                <p>
                  Existem {categoryTotals.semCategoriaCount} lançamento(s) sem categoria no
                  período (total{" "}
                  {categoryTotals.semCategoriaTotal.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                  ) — não entram no resultado.
                </p>
              ) : null}
              {categoryTotals.unmappedCategoryIds.size > 0 ? (
                <p>
                  {categoryTotals.unmappedCategoryIds.size} categoria(s) com classificação fora
                  do plano DRE (excluídas do cálculo
                  {categoryTotals.unmappedTotal > 0
                    ? `; total não alocado ${categoryTotals.unmappedTotal.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}`
                    : ""}
                  ).
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <Card className="border-border/80 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Resumo analítico</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Receitas em verde, deduções em âmbar, custos e despesas em vermelho, resultados em
            destaque.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-0 pt-0">
          {loading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : !computed ? (
            <p className="py-8 text-sm text-muted-foreground">Sem dados para exibir.</p>
          ) : (
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
                label="Deduções da receita / despesas sobre vendas"
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
                label="CMV (custo das mercadorias vendidas)"
                amount={-computed.cmv}
                tone="despesa"
                prefix="(−)"
                tree={trees?.cmv ?? []}
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
                      {computed.resultadoFinanceiroLiquido.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-4 pl-4 sm:pl-8">
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Receitas não operacionais
                      </p>
                      <DreTreePanel
                        nodes={trees?.finRec ?? []}
                        valueClassName="text-emerald-600 dark:text-emerald-400"
                      />
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Investimentos e financiamentos
                      </p>
                      <DreTreePanel
                        nodes={trees?.finDesp ?? []}
                        valueClassName="text-rose-700 dark:text-rose-400"
                        displayNegative
                      />
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
                    {computed.resultadoAntesImposto.toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })}
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

              <div className="py-3">
                <DreHighlightBlock label="Lucro líquido" amount={computed.lucroLiquido} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}

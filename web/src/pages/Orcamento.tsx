import { type MonthYear } from "@/components/MonthSelector";
import { ReferencePeriodCard } from "@/components/ReferencePeriodCard";
import { BudgetBasisToggle } from "@/components/budget/BudgetBasisToggle";
import { BudgetComparisonChart } from "@/components/budget/BudgetComparisonChart";
import { BudgetComparisonTable } from "@/components/budget/BudgetComparisonTable";
import { BudgetEmptyState } from "@/components/budget/BudgetEmptyState";
import { BudgetKpiCards } from "@/components/budget/BudgetKpiCards";
import { BudgetSetupCard } from "@/components/budget/BudgetSetupCard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { useCompany } from "@/contexts/CompanyContext";
import { useBudgetComparison } from "@/hooks/useBudgetComparison";
import { formatBrl } from "@/lib/dre/formatBrl";
import { ptBrUi } from "@/lib/ptBrUiStrings";
import {
  AlertTriangle,
  Copy,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";
import { toast } from "sonner";

export function OrcamentoPanel({
  period,
  onPeriodChange,
}: {
  period: MonthYear;
  onPeriodChange: (value: MonthYear) => void;
}) {
  const { currentCompany } = useCompany();

  const {
    loading,
    error,
    basis,
    setBasis,
    comparison,
    expenseCategoryCount,
    periodLabel,
    savingCategoryId,
    bulkActionLoading,
    avg3mByCategoryId,
    previousMonthBudgetCount,
    semCategoriaCount,
    semCategoriaTotal,
    saveBudget,
    copyFromPreviousMonth,
    applyAvg3mAsBudget,
    clearMonthBudgets,
    reload,
  } = useBudgetComparison(currentCompany?.id, period);

  const handleSaveBudget = async (categoryId: string, amount: number) => {
    try {
      await saveBudget(categoryId, amount);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível salvar o orçamento.",
      );
      throw e;
    }
  };

  const handleCopyPrevious = async () => {
    try {
      const count = await copyFromPreviousMonth();
      if (count === 0) {
        toast.info("Não há orçamentos no mês anterior para copiar.");
      } else {
        toast.success(
          `${count} ${count === 1 ? "categoria copiada" : "categorias copiadas"} do mês anterior.`,
        );
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Erro ao copiar orçamentos.",
      );
    }
  };

  const handleApplyAvg = async () => {
    try {
      const count = await applyAvg3mAsBudget();
      if (count === 0) {
        toast.info(
          "Não há média dos 3 meses anteriores para preencher. Classifique despesas nos meses passados ou defina o orçado manualmente.",
        );
      } else {
        toast.success(
          `Orçado preenchido com a média de ${count} categoria(s).`,
        );
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Erro ao aplicar média.",
      );
    }
  };

  const handleClear = async () => {
    try {
      await clearMonthBudgets();
      toast.success("Orçamentos do mês removidos.");
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Erro ao limpar orçamentos.",
      );
    }
  };

  const scrollToTable = () => {
    document
      .getElementById("budget-comparison-table")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const showEmptyCategories =
    !loading && !error && expenseCategoryCount === 0;

  const summary = comparison?.summary ?? null;
  const hasNoBudgets = !loading && (summary?.totalBudgeted ?? 0) <= 0;
  const hasActual = !loading && (summary?.totalActual ?? 0) > 0;
  const mappedLeafCount = comparison?.leafCategoryIds.size ?? 0;
  const showUnmappedEmpty =
    !loading &&
    !error &&
    expenseCategoryCount > 0 &&
    mappedLeafCount === 0 &&
    (comparison?.sections.length ?? 0) === 0;
  const showKpis =
    loading ||
    (summary != null &&
      ((summary.totalBudgeted ?? 0) > 0 || (summary.totalActual ?? 0) > 0));
  const chartRows = comparison?.chartRows ?? [];
  const canApplyAvg = avg3mByCategoryId.size > 0;
  const canCopyPrevious = previousMonthBudgetCount > 0;

  const bulkToolbar = (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={loading || bulkActionLoading || !canApplyAvg}
        title={
          canApplyAvg
            ? undefined
            : "Não há média dos 3 meses anteriores para preencher."
        }
        onClick={() => void handleApplyAvg()}
      >
        <Sparkles className="mr-2 h-4 w-4" />
        Média 3 meses
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={loading || bulkActionLoading || !canCopyPrevious}
        title={
          canCopyPrevious
            ? undefined
            : "Não há orçamentos no mês anterior para copiar."
        }
        onClick={() => void handleCopyPrevious()}
      >
        <Copy className="mr-2 h-4 w-4" />
        Copiar mês anterior
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || bulkActionLoading || hasNoBudgets}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Limpar mês
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Limpar orçamentos do mês?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove as metas de {periodLabel.toLowerCase()}. O realizado não é
              alterado. Esta ação não desfaz sozinha.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleClear()}>
              Limpar orçamentos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  return (
    <div className="space-y-6">
      <Accordion type="single" collapsible>
        <AccordionItem value="como-conta" className="border-border/60">
          <AccordionTrigger className="py-2 text-sm text-muted-foreground hover:no-underline">
            Como o orçamento conta
          </AccordionTrigger>
          <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
            {ptBrUi.orcamento.comoConta}
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <ReferencePeriodCard
        value={period}
        onChange={onPeriodChange}
        title="Período de referência"
        description={`Comparativo de ${periodLabel.toLowerCase()}`}
      />

      <BudgetBasisToggle
        value={basis}
        onChange={setBasis}
        disabled={loading}
      />

      {error ? (
        <Card className="border-destructive/40 bg-destructive/5 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              Erro ao carregar
            </CardTitle>
            <CardDescription className="text-destructive/90">
              {error}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="outline" onClick={() => void reload()}>
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      ) : showEmptyCategories ? (
        <BudgetEmptyState />
      ) : showUnmappedEmpty ? (
        <BudgetEmptyState variant="unmapped" />
      ) : (
        <>
          {semCategoriaCount > 0 ? (
            <div
              role="status"
              className="flex flex-wrap items-start gap-3 rounded-lg border border-orange-300/70 bg-orange-50/70 px-4 py-3 text-sm dark:border-orange-500/40 dark:bg-orange-500/10"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-300" />
              <div className="min-w-0 flex-1 text-muted-foreground">
                <p className="font-medium text-foreground">
                  {semCategoriaCount} despesa(s) sem categoria (
                  {formatBrl(semCategoriaTotal)})
                </p>
                <p>
                  Não entram no realizado do orçamento. Classifique em{" "}
                  <Link
                    to="/app/dre?view=sem-categoria&from=orcamento"
                    className="font-medium text-orange-800 underline underline-offset-2 dark:text-orange-200"
                  >
                    DRE → Sem categoria
                  </Link>
                  .
                </p>
              </div>
            </div>
          ) : null}

          {hasNoBudgets && !loading ? (
            <BudgetSetupCard
              hasActual={hasActual}
              canApplyAvg={canApplyAvg}
              canCopyPrevious={canCopyPrevious}
              bulkLoading={bulkActionLoading}
              onApplyAvg={() => void handleApplyAvg()}
              onCopyPrevious={() => void handleCopyPrevious()}
              onScrollToTable={scrollToTable}
            />
          ) : null}

          {showKpis ? (
            <BudgetKpiCards summary={summary} loading={loading} />
          ) : null}

          {loading ? (
            <Card className="border-border/80 shadow-sm">
              <CardContent className="space-y-3 py-6">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>
          ) : (
            <BudgetComparisonTable
              sections={comparison?.sections ?? []}
              onSaveBudget={handleSaveBudget}
              savingCategoryId={savingCategoryId}
              disabled={bulkActionLoading}
              avg3mByCategoryId={avg3mByCategoryId}
              toolbar={bulkToolbar}
            />
          )}

          {!loading && chartRows.length > 0 ? (
            <BudgetComparisonChart chartRows={chartRows} loading={false} />
          ) : null}
        </>
      )}
    </div>
  );
}

export function Orcamento() {
  const now = new Date();
  const [period, setPeriod] = useState<MonthYear>({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  });

  return (
    <PageShell>
      <PageHeader
        title="Orçamento vs Realizado"
        description="Meta de custo por categoria versus o que já foi gasto no mês — não é o lucro do DRE."
        icon={Target}
      />
      <OrcamentoPanel period={period} onPeriodChange={setPeriod} />
    </PageShell>
  );
}

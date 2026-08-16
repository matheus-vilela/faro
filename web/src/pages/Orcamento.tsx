import { type MonthYear } from "@/components/MonthSelector";
import { ReferencePeriodCard } from "@/components/ReferencePeriodCard";
import { BudgetBasisToggle } from "@/components/budget/BudgetBasisToggle";
import { BudgetComparisonChart } from "@/components/budget/BudgetComparisonChart";
import { BudgetComparisonTable } from "@/components/budget/BudgetComparisonTable";
import { BudgetEmptyState } from "@/components/budget/BudgetEmptyState";
import { BudgetKpiCards } from "@/components/budget/BudgetKpiCards";
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

  const showEmptyCategories =
    !loading && !error && expenseCategoryCount === 0;

  const summary = comparison?.summary ?? null;
  const hasNoBudgets = !loading && (summary?.totalBudgeted ?? 0) <= 0;
  const hasNoActual =
    !loading &&
    (summary?.totalActual ?? 0) <= 0 &&
    semCategoriaCount === 0;

  return (
    <div className="space-y-6">
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
                    to="/app/dre?view=sem-categoria"
                    className="font-medium text-orange-800 underline underline-offset-2 dark:text-orange-200"
                  >
                    Resultado → Sem categoria
                  </Link>
                  .
                </p>
              </div>
            </div>
          ) : null}

          {hasNoBudgets && !hasNoActual ? (
            <div
              role="status"
              className="flex flex-col gap-3 rounded-lg border border-primary/25 bg-primary/5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="text-muted-foreground">
                Há despesas no período, mas o <strong className="text-foreground">orçado</strong>{" "}
                ainda não foi definido — por isso os KPIs de meta ficam zerados.
              </p>
              <Button
                type="button"
                size="sm"
                disabled={bulkActionLoading || avg3mByCategoryId.size === 0}
                onClick={() => void handleApplyAvg()}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Preencher com média 3 meses
              </Button>
            </div>
          ) : null}

          {hasNoBudgets && hasNoActual && semCategoriaCount === 0 && !loading ? (
            <Card className="border-border/80 shadow-sm">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                Nenhuma despesa classificada neste mês. Cadastre contas a pagar
                com categoria do plano, ou defina o orçado nas linhas abaixo.
              </CardContent>
            </Card>
          ) : null}

          <BudgetKpiCards summary={summary} loading={loading} />

          {loading ? (
            <Skeleton className="h-[280px] w-full sm:h-[360px]" />
          ) : (
            <BudgetComparisonChart
              chartRows={comparison?.chartRows ?? []}
              loading={loading}
            />
          )}

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
            />
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || bulkActionLoading}
              onClick={() => void handleApplyAvg()}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Preencher com média 3 meses
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || bulkActionLoading}
              onClick={() => void handleCopyPrevious()}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copiar do mês anterior
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || bulkActionLoading}
              onClick={() => void handleClear()}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Limpar orçamentos do mês
            </Button>
          </div>
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
        description="Metas de custo/despesa por categoria — o realizado usa contas a pagar (e CMV de vendas na competência)."
        icon={Target}
      />
      <OrcamentoPanel period={period} onPeriodChange={setPeriod} />
    </PageShell>
  );
}

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
import { AlertTriangle, Copy, Target, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function Orcamento() {
  const { currentCompany } = useCompany();
  const now = new Date();
  const [period, setPeriod] = useState<MonthYear>({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  });

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
    saveBudget,
    copyFromPreviousMonth,
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

  return (
    <PageShell>
      <PageHeader
        title="Orçamento vs Realizado"
        description="Metas de custo/despesa por categoria — o realizado usa contas a pagar (não o lucro do DRE)."
        icon={Target}
      />

      <ReferencePeriodCard
        value={period}
        onChange={setPeriod}
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
          <BudgetKpiCards summary={comparison?.summary ?? null} loading={loading} />

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
    </PageShell>
  );
}

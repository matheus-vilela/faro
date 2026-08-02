import { CashFlowEmptyState } from "@/components/cashFlowSimulation/CashFlowEmptyState";
import { CashFlowKpiCards } from "@/components/cashFlowSimulation/CashFlowKpiCards";
import { CashFlowOpeningBalanceInput } from "@/components/cashFlowSimulation/CashFlowOpeningBalanceInput";
import { CashFlowPeriodTable } from "@/components/cashFlowSimulation/CashFlowPeriodTable";
import { CashFlowProjectionChart } from "@/components/cashFlowSimulation/CashFlowProjectionChart";
import { CashFlowScenarioToolbar } from "@/components/cashFlowSimulation/CashFlowScenarioToolbar";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useCompany } from "@/contexts/CompanyContext";
import { useCashFlowSimulation } from "@/hooks/useCashFlowSimulation";
import { formatBrl } from "@/lib/dre/formatBrl";
import { AlertTriangle, ArrowLeftRight, Loader2, RefreshCw } from "lucide-react";

export function FluxoDeCaixa() {
  const { currentCompany, currentPermissions, isCompanyOwner } = useCompany();
  const {
    prefs,
    loading,
    error,
    projection,
    diagnostics,
    openingBalanceHint,
    hasVisibleMovements,
    partialAccess,
    includePayables,
    includeReceivables,
    setScenario,
    setHorizonWeeks,
    setOpeningBalance,
    retry,
  } = useCashFlowSimulation(
    currentCompany?.id,
    currentPermissions,
    isCompanyOwner,
    currentCompany?.accounting_week_starts_on,
  );

  const showEmptyState = !loading && !error && !hasVisibleMovements;

  return (
    <PageShell>
      <PageHeader
        title="Fluxo de caixa"
        icon={ArrowLeftRight}
        description="Simule entradas e saídas conhecidas e veja se terá caixa nas próximas semanas."
      />

      <CashFlowScenarioToolbar
        scenario={prefs.scenario}
        horizonWeeks={prefs.horizonWeeks}
        onScenarioChange={setScenario}
        onHorizonChange={setHorizonWeeks}
        disabled={loading}
      />

      <CashFlowOpeningBalanceInput
        value={prefs.openingBalance}
        onChange={setOpeningBalance}
        hint={openingBalanceHint}
        loadingHint={loading}
        disabled={loading}
      />

      {partialAccess ? (
        <Card className="border-amber-500/40 bg-amber-500/5 shadow-sm">
          <CardContent className="flex items-start gap-3 px-4 py-4 sm:px-5">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="text-sm">
              <p className="font-medium text-foreground">Projeção parcial</p>
              <p className="text-muted-foreground">
                Seu perfil não inclui acesso completo a contas a pagar e vendas
                realizadas. A simulação usa apenas os dados disponíveis.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <Card className="border-destructive/40 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-destructive">
              Erro ao carregar simulação
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" variant="outline" onClick={() => void retry()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <CashFlowKpiCards
        kpis={projection.kpis}
        loading={loading}
        formatCurrency={formatBrl}
      />

      {projection.meta.clampedToLastBucketCount > 0 && hasVisibleMovements ? (
        <Card className="border-amber-500/30 bg-amber-500/5 shadow-sm">
          <CardContent className="px-4 py-3 text-sm text-muted-foreground sm:px-5">
            {projection.meta.clampedToLastBucketCount}{" "}
            {projection.meta.clampedToLastBucketCount === 1
              ? "conta foi alocada"
              : "contas foram alocadas"}{" "}
            na última semana porque o cenário empurrou o vencimento além do
            horizonte selecionado.
          </CardContent>
        </Card>
      ) : null}

      {showEmptyState ? (
        <CashFlowEmptyState
          diagnostics={diagnostics}
          partialAccess={partialAccess}
          includePayables={includePayables}
          includeReceivables={includeReceivables}
          horizonWeeks={prefs.horizonWeeks}
          clampedToLastBucketCount={projection.meta.clampedToLastBucketCount}
        />
      ) : null}

      <CashFlowProjectionChart buckets={projection.buckets} loading={loading} />

      <CashFlowPeriodTable
        buckets={projection.buckets}
        loading={loading}
        formatCurrency={formatBrl}
      />

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Atualizando projeção…
        </div>
      ) : null}
    </PageShell>
  );
}

import { DashboardDayOperations } from "@/components/dashboard/DashboardDayOperations";
import { DashboardEpocDailySyncAlertCard } from "@/components/dashboard/DashboardEpocDailySyncAlertCard";
import { DashboardFocusNfeRecebidasSyncCard } from "@/components/dashboard/DashboardFocusNfeRecebidasSyncCard";
import { DashboardIntegrationCsvRevenueCard } from "@/components/dashboard/DashboardIntegrationCsvRevenueCard";
import { DashboardPurchasesSection } from "@/components/dashboard/DashboardPurchasesSection";
import { PendingWhatsappExpensesCard } from "@/components/dashboard/PendingWhatsappExpensesCard";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { useCompany } from "@/contexts/CompanyContext";
import { isOnboardingFiscalDashboardCardVisible } from "@/lib/onboardingFiscalDashboard";
import { isOnboardingPdvDashboardCardVisible } from "@/lib/onboardingPdvDefaults";
import { LayoutDashboard } from "lucide-react";

function formatLongDate(d: Date): string {
  return d.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function Dashboard() {
  const { currentCompany, isCompanyOwner } = useCompany();
  const companyId = currentCompany?.id;
  const isOwner = isCompanyOwner;

  const headerDescription = (
    <span className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2">
      <span>
        {currentCompany
          ? `Empresa: ${currentCompany.name}`
          : "Visão geral da operação"}
      </span>
      <span className="hidden text-muted-foreground sm:inline">·</span>
      <span className="capitalize text-muted-foreground">
        {formatLongDate(new Date())}
      </span>
    </span>
  );

  return (
    <PageShell className="space-y-8">
      <PageHeader
        title="Início"
        description={headerDescription}
        icon={LayoutDashboard}
      />

      {currentCompany &&
      isOnboardingFiscalDashboardCardVisible(
        currentCompany.onboarding_fiscal,
      ) ? (
        <DashboardFocusNfeRecebidasSyncCard company={currentCompany} />
      ) : null}
      {currentCompany &&
      isOnboardingPdvDashboardCardVisible(currentCompany.onboarding_pdv) ? (
        <DashboardIntegrationCsvRevenueCard company={currentCompany} />
      ) : null}
      {companyId ? (
        <DashboardEpocDailySyncAlertCard companyId={companyId} />
      ) : null}
      {/* {companyId ? (
        <DashboardEpocPartialSyncCard companyId={companyId} />
      ) : null} */}
      {/* {currentCompany ? <SetupProgressCard /> : null} */}

      {companyId ? <DashboardDayOperations /> : null}

      {companyId ? <DashboardPurchasesSection /> : null}

      {/* <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 lg:items-start lg:gap-6 xl:gap-8">
        <section aria-label="Acesso rápido" className="min-w-0">
          <DashboardQuickLinks role={currentRole} />
        </section>
        <section aria-label="Resumo do dia e alertas" className="min-w-0">
          <DashboardOperationalPulse
            role={currentRole}
            loadingBoletos={loadingBoletos}
            todayCount={todayBoletos.length}
            todayTotal={todayTotal}
            tomorrowCount={tomorrowBoletos.length}
            tomorrowTotal={tomorrowTotal}
            loadingAlerts={loadingAlerts}
            totalAlerts={totalAlerts}
            formatCurrency={formatCurrency}
          />
        </section>
      </div> */}

      <div className="grid gap-6">
        {isOwner && currentCompany ? <PendingWhatsappExpensesCard /> : null}
      </div>
    </PageShell>
  );
}

import { DashboardDayOperations } from "@/components/dashboard/DashboardDayOperations";
import { DashboardEpocDailySyncAlertCard } from "@/components/dashboard/DashboardEpocDailySyncAlertCard";
import { DashboardFocusNfeRecebidasSyncCard } from "@/components/dashboard/DashboardFocusNfeRecebidasSyncCard";
import { DashboardHomeInsightBand } from "@/components/dashboard/DashboardHomeInsightBand";
import { DashboardHomeKpiRow } from "@/components/dashboard/DashboardHomeKpiRow";
import { DashboardHomeSalesSnapshot } from "@/components/dashboard/DashboardHomeSalesSnapshot";
import { DashboardIntegrationCsvRevenueCard } from "@/components/dashboard/DashboardIntegrationCsvRevenueCard";
import { DashboardNeedsYouQueue } from "@/components/dashboard/DashboardNeedsYouQueue";
import { DashboardUpcomingPayables } from "@/components/dashboard/DashboardUpcomingPayables";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useDashboardHomeData } from "@/hooks/useDashboardHomeData";
import {
  useDashboardHomePeriod,
  type DashboardHomePeriod,
} from "@/hooks/useDashboardHomePeriod";
import {
  firstNameFromUser,
  greetingForHour,
} from "@/lib/dashboardHomeActions";
import { isOnboardingFiscalDashboardCardVisible } from "@/lib/onboardingFiscalDashboard";
import { isOnboardingPdvDashboardCardVisible } from "@/lib/onboardingPdvDefaults";
import { cn } from "@/lib/utils";
import { LayoutDashboard } from "lucide-react";

function formatLongDate(d: Date): string {
  return d.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function PeriodToggle({
  period,
  options,
  onChange,
}: {
  period: DashboardHomePeriod;
  options: { value: DashboardHomePeriod; label: string }[];
  onChange: (p: DashboardHomePeriod) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border/80 bg-muted/40 p-0.5">
      {options.map((opt) => {
        const active = period === opt.value;
        return (
          <Button
            key={opt.value}
            type="button"
            size="sm"
            variant="ghost"
            className={cn(
              "h-8 rounded-md px-3 text-xs font-medium sm:px-4",
              active
                ? "bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </Button>
        );
      })}
    </div>
  );
}

export function Dashboard() {
  const { currentCompany } = useCompany();
  const { user } = useAuth();
  const companyId = currentCompany?.id;
  const { period, setPeriod, options } = useDashboardHomePeriod("last7");
  const home = useDashboardHomeData(period);

  const firstName = firstNameFromUser(user);
  const greeting = greetingForHour();

  const headerDescription = (
    <span className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2">
      <span>
        {currentCompany
          ? currentCompany.name
          : "Visão geral da operação"}
      </span>
      <span className="hidden text-muted-foreground sm:inline">·</span>
      <span className="capitalize text-muted-foreground">
        {formatLongDate(new Date())}
      </span>
    </span>
  );

  return (
    <PageShell className="space-y-6 sm:space-y-8">
      <PageHeader
        title="Visão geral"
        description={headerDescription}
        icon={LayoutDashboard}
        action={
          <PeriodToggle
            period={period}
            options={options}
            onChange={setPeriod}
          />
        }
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

      {companyId ? (
        <>
          <DashboardHomeInsightBand
            greeting={greeting}
            firstName={firstName}
            text={home.insight}
          />

          <DashboardHomeKpiRow
            loading={home.loading}
            faturamento={home.sales?.kpis.net.current ?? 0}
            faturamentoDeltaPct={home.sales?.kpis.net.pctChange ?? null}
            compareLabel={home.sales?.ranges.compareLabel ?? "vs período anterior"}
            marginPct={home.marginPct}
            cmvPct={home.cmvPct}
            dueIn7Amount={home.dueIn7Amount}
            dueIn7Count={home.dueIn7Count}
            lucroMes={home.lucroMes}
          />

          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr] lg:items-start">
            <DashboardNeedsYouQueue
              items={home.actions}
              loading={home.actionsLoading}
              onChanged={() => void home.reloadActions()}
            />
            <DashboardUpcomingPayables
              rows={home.upcoming}
              loading={home.loading}
            />
          </div>

          <DashboardHomeSalesSnapshot
            sales={home.sales}
            loading={home.loading}
            periodWord={home.periodWord}
          />

          <DashboardDayOperations hidePayables />
        </>
      ) : null}
    </PageShell>
  );
}

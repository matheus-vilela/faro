import { DashboardDayOperations } from "@/components/dashboard/DashboardDayOperations";
import { DashboardPurchasesSection } from "@/components/dashboard/DashboardPurchasesSection";
import { DashboardEpocDailySyncAlertCard } from "@/components/dashboard/DashboardEpocDailySyncAlertCard";
import { DashboardFocusNfeRecebidasSyncCard } from "@/components/dashboard/DashboardFocusNfeRecebidasSyncCard";
import { DashboardImportReviewHub } from "@/components/dashboard/DashboardImportReviewHub";
import { DashboardIntegrationCsvRevenueCard } from "@/components/dashboard/DashboardIntegrationCsvRevenueCard";
import { PendingWhatsappExpensesCard } from "@/components/dashboard/PendingWhatsappExpensesCard";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { useCompany } from "@/contexts/CompanyContext";
import { isOnboardingFiscalDashboardCardVisible } from "@/lib/onboardingFiscalDashboard";
import { isOnboardingPdvDashboardCardVisible } from "@/lib/onboardingPdvDefaults";
import { supabase } from "@/lib/supabase";
import type { Boleto } from "@/types/expense";
import { LayoutDashboard } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dueDateKey(s: string): string {
  return s.slice(0, 10);
}

interface AlertSummary {
  lowStock: number;
  withoutBoleto: number;
  notReceived: number;
  boletoD3: number;
  boletoD1: number;
  importPending: number;
}

function formatLongDate(d: Date): string {
  return d.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function Dashboard() {
  const { currentCompany, currentRole } = useCompany();
  const companyId = currentCompany?.id;
  const canSeeAlerts = currentRole === "gestor" || currentRole === "owner";
  const isOwner = currentRole === "owner";
  const [loadingBoletos, setLoadingBoletos] = useState(true);
  const [todayBoletos, setTodayBoletos] = useState<Boleto[]>([]);
  const [tomorrowBoletos, setTomorrowBoletos] = useState<Boleto[]>([]);

  const [loadingAlerts, setLoadingAlerts] = useState(true);
  const [alertSummary, setAlertSummary] = useState<AlertSummary>({
    lowStock: 0,
    withoutBoleto: 0,
    notReceived: 0,
    boletoD3: 0,
    boletoD1: 0,
    importPending: 0,
  });
  const [importReviewSeq, setImportReviewSeq] = useState(0);

  const bumpImportReviewPipeline = useCallback(() => {
    setImportReviewSeq((n) => n + 1);
  }, []);

  const loadBoletos = useCallback(async () => {
    if (!companyId) {
      setLoadingBoletos(false);
      setTodayBoletos([]);
      setTomorrowBoletos([]);
      return;
    }
    setLoadingBoletos(true);
    const todayStr = localDateKey(new Date());
    const next = new Date();
    next.setDate(next.getDate() + 1);
    const tomorrowStr = localDateKey(next);

    const { data, error } = await supabase
      .from("boletos")
      .select("id, description, due_date, amount, status")
      .eq("company_id", companyId)
      .eq("flow_type", "payable")
      .eq("exclude_from_fluxo", false)
      .in("due_date", [todayStr, tomorrowStr])
      .eq("status", "pending")
      .order("due_date", { ascending: true })
      .order("amount", { ascending: false });

    if (error) {
      setTodayBoletos([]);
      setTomorrowBoletos([]);
    } else {
      const list = (data ?? []) as Boleto[];
      setTodayBoletos(list.filter((b) => dueDateKey(b.due_date) === todayStr));
      setTomorrowBoletos(
        list.filter((b) => dueDateKey(b.due_date) === tomorrowStr),
      );
    }
    setLoadingBoletos(false);
  }, [companyId]);

  const loadAlertSummary = useCallback(async () => {
    if (!companyId || !canSeeAlerts) {
      setLoadingAlerts(false);
      setAlertSummary({
        lowStock: 0,
        withoutBoleto: 0,
        notReceived: 0,
        boletoD3: 0,
        boletoD1: 0,
        importPending: 0,
      });
      return;
    }
    setLoadingAlerts(true);

    const [{ data, error }, { count: openImportCount, error: importCountErr }] =
      await Promise.all([
        supabase
          .from("company_alerts")
          .select("kind")
          .eq("company_id", companyId)
          .eq("status", "open"),
        supabase
          .from("import_review_pending")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("status", "OPEN"),
      ]);

    if (error) {
      console.error(error);
      setAlertSummary({
        lowStock: 0,
        withoutBoleto: 0,
        notReceived: 0,
        boletoD3: 0,
        boletoD1: 0,
        importPending: 0,
      });
      setLoadingAlerts(false);
      return;
    }

    const list = data ?? [];
    const importPending = importCountErr
      ? 0
      : Math.max(0, openImportCount ?? 0);

    setAlertSummary({
      lowStock: list.filter((r) => r.kind === "low_stock").length,
      withoutBoleto: list.filter((r) => r.kind === "expense_no_boleto").length,
      notReceived: list.filter((r) => r.kind === "recebimento_falta").length,
      boletoD3: list.filter((r) => r.kind === "boleto_vencimento_d3").length,
      boletoD1: list.filter((r) => r.kind === "boleto_vencimento_d1").length,
      importPending,
    });
    setLoadingAlerts(false);
  }, [companyId, canSeeAlerts]);

  useEffect(() => {
    queueMicrotask(() => void loadBoletos());
  }, [loadBoletos]);

  useEffect(() => {
    queueMicrotask(() => void loadAlertSummary());
  }, [loadAlertSummary]);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(v);

  const todayTotal = useMemo(
    () => todayBoletos.reduce((s, b) => s + b.amount, 0),
    [todayBoletos],
  );
  const tomorrowTotal = useMemo(
    () => tomorrowBoletos.reduce((s, b) => s + b.amount, 0),
    [tomorrowBoletos],
  );

  const totalAlerts =
    alertSummary.lowStock +
    alertSummary.withoutBoleto +
    alertSummary.notReceived +
    alertSummary.boletoD3 +
    alertSummary.boletoD1 +
    alertSummary.importPending;

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

        {canSeeAlerts && companyId ? (
          <DashboardImportReviewHub
            companyId={companyId}
            refreshSignal={importReviewSeq}
            onPipelineChange={bumpImportReviewPipeline}
          />
        ) : null}
      </div>
    </PageShell>
  );
}

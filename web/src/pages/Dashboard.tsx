import { DashboardAlertsCard } from "@/components/dashboard/DashboardAlertsCard";
import { DashboardOperationalPulse } from "@/components/dashboard/DashboardOperationalPulse";
import { DashboardQuickLinks } from "@/components/dashboard/DashboardQuickLinks";
import { PendingWhatsappExpensesCard } from "@/components/dashboard/PendingWhatsappExpensesCard";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { useCompany } from "@/contexts/CompanyContext";
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
  });

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
      setAlertSummary({ lowStock: 0, withoutBoleto: 0, notReceived: 0 });
      return;
    }
    setLoadingAlerts(true);

    const { data, error } = await supabase
      .from("company_alerts")
      .select("kind")
      .eq("company_id", companyId)
      .eq("status", "open");

    if (error) {
      console.error(error);
      setAlertSummary({ lowStock: 0, withoutBoleto: 0, notReceived: 0 });
      setLoadingAlerts(false);
      return;
    }

    const list = data ?? [];
    setAlertSummary({
      lowStock: list.filter((r) => r.kind === "low_stock").length,
      withoutBoleto: list.filter((r) => r.kind === "expense_no_boleto").length,
      notReceived: list.filter((r) => r.kind === "recebimento_falta").length,
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
    alertSummary.notReceived;

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

      <DashboardQuickLinks role={currentRole} />

      <div
        className={`grid gap-6 ${canSeeAlerts ? "lg:grid-cols-2" : "lg:max-w-3xl"}`}
      >
        {canSeeAlerts ? (
          <DashboardAlertsCard
            loading={loadingAlerts}
            totalAlerts={totalAlerts}
            lowStock={alertSummary.lowStock}
            withoutBoleto={alertSummary.withoutBoleto}
            notReceived={alertSummary.notReceived}
          />
        ) : null}
        {isOwner && currentCompany ? <PendingWhatsappExpensesCard /> : null}
      </div>
    </PageShell>
  );
}

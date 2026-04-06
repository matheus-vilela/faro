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
import { PendingWhatsappExpensesCard } from "@/components/dashboard/PendingWhatsappExpensesCard";
import { useCompany } from "@/contexts/CompanyContext";
import { syncCompanyAlerts } from "@/lib/companyAlerts/syncCompanyAlerts";
import { supabase } from "@/lib/supabase";
import type { Boleto } from "@/types/expense";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarDays,
  FileText,
  LayoutDashboard,
  Loader2,
  PackageX,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

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

export function Dashboard() {
  const { currentCompany, currentRole } = useCompany();
  const canSeeAlerts =
    currentRole === "gestor" || currentRole === "owner";
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
    if (!currentCompany?.id) {
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
      .eq("company_id", currentCompany.id)
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
      setTodayBoletos(
        list.filter((b) => dueDateKey(b.due_date) === todayStr),
      );
      setTomorrowBoletos(
        list.filter((b) => dueDateKey(b.due_date) === tomorrowStr),
      );
    }
    setLoadingBoletos(false);
  }, [currentCompany?.id]);

  const loadAlertSummary = useCallback(async () => {
    if (!currentCompany?.id || !canSeeAlerts) {
      setLoadingAlerts(false);
      setAlertSummary({ lowStock: 0, withoutBoleto: 0, notReceived: 0 });
      return;
    }
    setLoadingAlerts(true);

    const companyId = currentCompany.id;
    await syncCompanyAlerts(companyId);

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
  }, [currentCompany?.id, canSeeAlerts]);

  useEffect(() => {
    void loadBoletos();
  }, [loadBoletos]);

  useEffect(() => {
    void loadAlertSummary();
  }, [loadAlertSummary]);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(v);

  const formatDayTitle = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "short",
    });
  };

  const totalAlerts =
    alertSummary.lowStock +
    alertSummary.withoutBoleto +
    alertSummary.notReceived;

  return (
    <PageShell className="space-y-8">
      <PageHeader
        title="Dashboard"
        description={`Bem-vindo ao Faro${currentCompany ? ` — ${currentCompany.name}` : ""}`}
        icon={LayoutDashboard}
      />

      <div
        className={`grid gap-4 ${canSeeAlerts ? "md:grid-cols-2" : "md:max-w-xl"}`}
      >
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <CalendarDays className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle className="text-lg">Contas a pagar</CardTitle>
                  <CardDescription>
                    Pendentes com vencimento hoje e amanhã
                  </CardDescription>
                </div>
              </div>
              <Button variant="outline" size="sm" asChild className="shrink-0">
                <Link to="/app/fluxo-de-caixa">
                  Ver tudo
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingBoletos ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando…
              </div>
            ) : (
              <>
                <DashboardBoletoDayBlock
                  label="Hoje"
                  sublabel={formatDayTitle(localDateKey(new Date()))}
                  items={todayBoletos}
                  formatCurrency={formatCurrency}
                />
                <DashboardBoletoDayBlock
                  label="Amanhã"
                  sublabel={formatDayTitle(
                    localDateKey(
                      (() => {
                        const d = new Date();
                        d.setDate(d.getDate() + 1);
                        return d;
                      })(),
                    ),
                  )}
                  items={tomorrowBoletos}
                  formatCurrency={formatCurrency}
                />
              </>
            )}
          </CardContent>
        </Card>

        {canSeeAlerts && (
          <Card className="overflow-hidden border-l-4 border-l-amber-500/70 shadow-sm ring-1 ring-border/60">
            <CardHeader className="pb-3 bg-gradient-to-br from-amber-500/[0.06] to-transparent dark:from-amber-500/10">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-500/25 bg-amber-500/15 text-amber-700 dark:text-amber-400">
                    <Bell className="h-5 w-5" strokeWidth={2} />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="text-lg font-semibold tracking-tight">
                      Alertas
                    </CardTitle>
                    <CardDescription className="mt-0.5">
                      Resumo do que precisa de atenção na operação
                    </CardDescription>
                  </div>
                </div>
                <Button variant="outline" size="sm" asChild className="shrink-0 shadow-sm">
                  <Link to="/app/alertas">
                    Ver todos
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              {loadingAlerts ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm py-6 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando…
                </div>
              ) : totalAlerts === 0 ? (
                <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center">
                  <p className="text-sm text-muted-foreground">
                    Nenhum alerta aberto no momento.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  <li>
                    <Link
                      to="/app/alertas?kind=recebimento_falta"
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-foreground">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-500/15 text-orange-700 dark:text-orange-400">
                          <PackageX className="h-4 w-4" />
                        </span>
                        <span className="truncate">Itens não entregues</span>
                      </span>
                      <span className="shrink-0 rounded-md bg-background px-2 py-0.5 text-sm font-bold tabular-nums shadow-sm">
                        {alertSummary.notReceived}
                      </span>
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/app/alertas?kind=expense_no_boleto"
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-foreground">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-800 dark:text-amber-400">
                          <FileText className="h-4 w-4" />
                        </span>
                        <span className="truncate">Despesas sem boleto</span>
                      </span>
                      <span className="shrink-0 rounded-md bg-background px-2 py-0.5 text-sm font-bold tabular-nums shadow-sm">
                        {alertSummary.withoutBoleto}
                      </span>
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/app/produtos?estoque=baixo"
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-foreground">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-500/15 text-rose-700 dark:text-rose-400">
                          <AlertTriangle className="h-4 w-4" />
                        </span>
                        <span className="truncate">Estoque baixo</span>
                      </span>
                      <span className="shrink-0 rounded-md bg-background px-2 py-0.5 text-sm font-bold tabular-nums shadow-sm">
                        {alertSummary.lowStock}
                      </span>
                    </Link>
                  </li>
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {isOwner && currentCompany && (
        <PendingWhatsappExpensesCard />
      )}
    </PageShell>
  );
}

function DashboardBoletoDayBlock({
  label,
  sublabel,
  items,
  formatCurrency,
}: {
  label: string;
  sublabel: string;
  items: Boleto[];
  formatCurrency: (v: number) => string;
}) {
  const total = items.reduce((s, b) => s + b.amount, 0);

  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-3">
      <div className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-2 mb-2">
        <div>
          <p className="text-sm font-semibold">{label}</p>
          <p className="text-xs text-muted-foreground capitalize">{sublabel}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">
            {items.length} conta{items.length !== 1 ? "s" : ""}
          </p>
          {items.length > 0 && (
            <p className="text-sm font-semibold text-primary tabular-nums">
              {formatCurrency(total)}
            </p>
          )}
        </div>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-1">Nenhuma pendente.</p>
      ) : (
        <ul className="space-y-2 max-h-40 overflow-y-auto">
          {items.map((b) => (
            <li
              key={b.id}
              className="flex items-start justify-between gap-2 text-sm"
            >
              <span className="min-w-0 truncate font-medium">{b.description}</span>
              <span className="shrink-0 font-semibold tabular-nums text-primary">
                {formatCurrency(b.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

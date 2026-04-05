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
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/product";
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

    const [{ data: productsData }, { data: expensesData }, { data: boletosData }, { data: notReceivedData }] =
      await Promise.all([
        supabase
          .from("products")
          .select("*")
          .eq("company_id", companyId)
          .gt("min_quantity", 0),
        supabase
          .from("expenses")
          .select("id, expense_source, status")
          .eq("company_id", companyId),
        supabase
          .from("boletos")
          .select("expense_id")
          .eq("company_id", companyId)
          .eq("flow_type", "payable")
          .not("expense_id", "is", null),
        supabase
          .from("recebimento_item_status")
          .select(
            `
          id,
          recebimento_id,
          expense_item_id,
          quantity_received,
          status,
          recebimentos!inner (
            expense_id,
            received_at,
            expenses!inner (
              supplier_name,
              display_name,
              invoice_number,
              company_id
            )
          ),
          expense_items!inner (
            product_name,
            quantity
          )
        `,
          )
          .in("status", ["not_received", "partial"]),
      ]);

    const list = (productsData ?? []) as Product[];
    const lowStock = list.filter(
      (p) => p.current_quantity <= p.min_quantity && p.is_active !== false,
    ).length;

    const linkedExpenseIds = new Set(
      (boletosData ?? [])
        .map((b) => b.expense_id)
        .filter(Boolean) as string[],
    );
    const expenseRows = (expensesData ?? []) as {
      id: string;
      expense_source?: string | null;
      status?: string | null;
    }[];
    const expenseIds = expenseRows
      .filter(
        (e) =>
          !(
            e.expense_source === "whatsapp" &&
            e.status === "pending"
          ),
      )
      .map((e) => e.id);
    const withoutBoleto = expenseIds.filter((id) => !linkedExpenseIds.has(id))
      .length;

    let notReceived = 0;
    for (const r of notReceivedData ?? []) {
      const rec = r as unknown as {
        recebimentos:
          | {
              expense_id: string;
              received_at: string | null;
              expenses:
                | {
                    supplier_name: string | null;
                    display_name: string | null;
                    invoice_number: string | null;
                    company_id: string;
                  }
                | {
                    supplier_name: string | null;
                    display_name: string | null;
                    invoice_number: string | null;
                    company_id: string;
                  }[];
            }
          | {
              expense_id: string;
              received_at: string | null;
              expenses:
                | {
                    supplier_name: string | null;
                    display_name: string | null;
                    invoice_number: string | null;
                    company_id: string;
                  }
                | {
                    supplier_name: string | null;
                    display_name: string | null;
                    invoice_number: string | null;
                    company_id: string;
                  }[];
            }[];
      };
      const rb = Array.isArray(rec.recebimentos)
        ? rec.recebimentos[0]
        : rec.recebimentos;
      const exp =
        rb && (Array.isArray(rb.expenses) ? rb.expenses[0] : rb.expenses);
      if (exp && exp.company_id === companyId) notReceived += 1;
    }

    setAlertSummary({ lowStock, withoutBoleto, notReceived });
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
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <Bell className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">Alertas</CardTitle>
                    <CardDescription>
                      Resumo do que precisa de atenção
                    </CardDescription>
                  </div>
                </div>
                <Button variant="outline" size="sm" asChild className="shrink-0">
                  <Link to="/app/alertas">
                    Abrir
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingAlerts ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Carregando…
                </div>
              ) : totalAlerts === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  Nenhum alerta ativo no momento.
                </p>
              ) : (
                <ul className="space-y-3 text-sm">
                  <li className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <PackageX className="h-4 w-4 shrink-0 text-destructive" />
                      Itens não entregues
                    </span>
                    <span className="font-semibold tabular-nums">
                      {alertSummary.notReceived}
                    </span>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <FileText className="h-4 w-4 shrink-0 text-amber-600" />
                      Despesas sem boleto
                    </span>
                    <span className="font-semibold tabular-nums">
                      {alertSummary.withoutBoleto}
                    </span>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                      Estoque baixo
                    </span>
                    <span className="font-semibold tabular-nums">
                      {alertSummary.lowStock}
                    </span>
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

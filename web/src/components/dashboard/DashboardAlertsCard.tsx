import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarClock,
  FileText,
  Loader2,
  PackageX,
} from "lucide-react";
import { Link } from "react-router-dom";

export function DashboardAlertsCard({
  loading,
  totalAlerts,
  lowStock,
  withoutBoleto,
  notReceived,
  boletoD3,
  boletoD1,
}: {
  loading: boolean;
  totalAlerts: number;
  lowStock: number;
  withoutBoleto: number;
  notReceived: number;
  boletoD3: number;
  boletoD1: number;
}) {
  return (
    <Card className="overflow-hidden border-l-4 border-l-amber-500/80 shadow-sm ring-1 ring-border/60">
      <CardHeader className="border-b border-border/50 bg-linear-to-br from-amber-500/[0.07] to-transparent pb-4 dark:from-amber-500/12">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/15 text-amber-800 dark:text-amber-400">
              <Bell className="h-5 w-5" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-lg font-semibold tracking-tight">
                Alertas da operação
              </CardTitle>
              <CardDescription className="mt-1">
                Estoque, recebimentos e despesas — toque para abrir só aquele
                tipo.
              </CardDescription>
            </div>
          </div>
          <Button variant="outline" size="sm" className="shrink-0" asChild>
            <Link to="/app/alertas">
              Ver todos
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-5">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando alertas…
          </div>
        ) : totalAlerts === 0 ? (
          <div className="rounded-xl border border-dashed bg-muted/25 px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhum alerta aberto. Boa conferência.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            <li>
              <Link
                to="/app/alertas?kind=boleto_vencimento_d1"
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-800 dark:text-red-400">
                    <CalendarClock className="h-4 w-4" />
                  </span>
                  <span className="truncate">Boletos D-1 (amanhã)</span>
                </span>
                <span className="shrink-0 rounded-md bg-background px-2.5 py-1 text-sm font-bold tabular-nums shadow-sm">
                  {boletoD1}
                </span>
              </Link>
            </li>
            <li>
              <Link
                to="/app/alertas?kind=boleto_vencimento_d3"
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-900 dark:text-amber-400">
                    <CalendarClock className="h-4 w-4" />
                  </span>
                  <span className="truncate">Boletos D-3 (em 3 dias)</span>
                </span>
                <span className="shrink-0 rounded-md bg-background px-2.5 py-1 text-sm font-bold tabular-nums shadow-sm">
                  {boletoD3}
                </span>
              </Link>
            </li>
            <li>
              <Link
                to="/app/alertas?kind=recebimento_falta"
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-500/15 text-orange-800 dark:text-orange-400">
                    <PackageX className="h-4 w-4" />
                  </span>
                  <span className="truncate">Itens não entregues</span>
                </span>
                <span className="shrink-0 rounded-md bg-background px-2.5 py-1 text-sm font-bold tabular-nums shadow-sm">
                  {notReceived}
                </span>
              </Link>
            </li>
            <li>
              <Link
                to="/app/alertas?kind=expense_no_boleto"
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-900 dark:text-amber-400">
                    <FileText className="h-4 w-4" />
                  </span>
                  <span className="truncate">Despesas sem boleto</span>
                </span>
                <span className="shrink-0 rounded-md bg-background px-2.5 py-1 text-sm font-bold tabular-nums shadow-sm">
                  {withoutBoleto}
                </span>
              </Link>
            </li>
            <li>
              <Link
                to="/app/produtos?estoque=baixo"
                className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-3 py-3 transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex min-w-0 items-center gap-2.5 text-sm font-medium">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500/15 text-rose-800 dark:text-rose-400">
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  <span className="truncate">Estoque baixo</span>
                </span>
                <span className="shrink-0 rounded-md bg-background px-2.5 py-1 text-sm font-bold tabular-nums shadow-sm">
                  {lowStock}
                </span>
              </Link>
            </li>
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

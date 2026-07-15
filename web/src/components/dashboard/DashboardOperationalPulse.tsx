import { DashboardWhatsappPulseTile } from "@/components/dashboard/DashboardWhatsappPulseTile";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  Bell,
  CalendarClock,
  CalendarDays,
  Loader2,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function DashboardOperationalPulse({
  canSeeAlerts,
  loadingBoletos,
  todayCount,
  todayTotal,
  tomorrowCount,
  tomorrowTotal,
  loadingAlerts,
  totalAlerts,
  formatCurrency,
}: {
  canSeeAlerts: boolean;
  loadingBoletos: boolean;
  todayCount: number;
  todayTotal: number;
  tomorrowCount: number;
  tomorrowTotal: number;
  loadingAlerts: boolean;
  totalAlerts: number;
  formatCurrency: (v: number) => string;
}) {
  return (
    <div className="min-w-0">
      <div className="grid grid-cols-2 gap-3">
        <PulseTile
          icon={CalendarDays}
          label="Vencem hoje"
          loading={loadingBoletos}
          primary={String(todayCount)}
          secondary={
            todayCount > 0 ? formatCurrency(todayTotal) : "Sem pendências"
          }
          tone="primary"
          action={
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              asChild
            >
              <Link to="/app/contas-a-pagar">
                Contas
                <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          }
        />
        <PulseTile
          icon={CalendarClock}
          label="Vencem amanhã"
          loading={loadingBoletos}
          primary={String(tomorrowCount)}
          secondary={
            tomorrowCount > 0 ? formatCurrency(tomorrowTotal) : "Sem pendências"
          }
          tone="muted"
          action={
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              asChild
            >
              <Link to="/app/contas-a-pagar">
                Contas
                <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          }
        />
        {canSeeAlerts ? (
          <>
            <PulseTile
              icon={Bell}
              label="Alertas abertos"
              loading={loadingAlerts}
              primary={totalAlerts > 0 ? String(totalAlerts) : "0"}
              secondary={totalAlerts === 0 ? "Nada pendente" : "Itens a conferir"}
              tone={totalAlerts > 0 ? "amber" : "muted"}
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  asChild
                >
                  <Link to="/app/alertas">
                    Lista
                    <ArrowRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              }
            />
            <DashboardWhatsappPulseTile />
          </>
        ) : (
          <DashboardWhatsappPulseTile />
        )}
      </div>
    </div>
  );
}

function PulseTile({
  icon: Icon,
  label,
  primary,
  secondary,
  loading,
  tone,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  primary: string;
  secondary: string;
  loading: boolean;
  tone: "primary" | "amber" | "muted";
  action: ReactNode;
}) {
  const ring =
    tone === "primary"
      ? "border-primary/25 bg-primary/[0.06]"
      : tone === "amber"
        ? "border-amber-500/35 bg-amber-500/[0.07] dark:bg-amber-500/10"
        : "border-border/80 bg-card";

  return (
    <div
      className={cn(
        "flex flex-col justify-between gap-2 rounded-xl border p-3 shadow-sm",
        ring,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
              tone === "primary" && "bg-primary/15 text-primary",
              tone === "amber" &&
                "bg-amber-500/15 text-amber-800 dark:text-amber-400",
              tone === "muted" && "bg-muted text-muted-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            {loading ? (
              <Loader2 className="mt-1 h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <p className="text-2xl font-bold tabular-nums leading-tight tracking-tight">
                {primary}
              </p>
            )}
          </div>
        </div>
        {!loading ? action : null}
      </div>
      {!loading && (
        <p className="wrap-anywhere text-xs text-muted-foreground">{secondary}</p>
      )}
    </div>
  );
}

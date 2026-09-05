import { FluxoBoletosPage } from "@/components/fluxo/FluxoBoletosPage";
import { CONTAS_A_PAGAR_FLUXO_CONFIG } from "@/components/fluxo/fluxoBoletosConfigs";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import {
  CONTAS_A_PAGAR_HOME_PATH,
  CONTAS_A_PAGAR_LIST_PATH,
  contasAPagarSectionFromPath,
} from "@/lib/contasAPagarPaths";
import { cn } from "@/lib/utils";
import { CalendarDays, List, TrendingDown, type LucideIcon } from "lucide-react";
import { NavLink, Navigate, useLocation } from "react-router-dom";

const CONTAS_NAV: {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  description: string;
}[] = [
  {
    to: CONTAS_A_PAGAR_HOME_PATH,
    label: "Calendário",
    icon: CalendarDays,
    end: true,
    description: "Vencimentos do mês no calendário.",
  },
  {
    to: CONTAS_A_PAGAR_LIST_PATH,
    label: "Listagem",
    icon: List,
    description: "Contas do mês em lista, por categoria, vencimento ou status.",
  },
];

export function ContasAPagar() {
  const { pathname } = useLocation();
  const section = contasAPagarSectionFromPath(pathname);

  if (!section) {
    return <Navigate to={CONTAS_A_PAGAR_HOME_PATH} replace />;
  }

  const activeNav =
    CONTAS_NAV.find((item) =>
      item.end
        ? pathname === item.to || pathname === `${item.to}/`
        : pathname === item.to || pathname.startsWith(`${item.to}/`),
    ) ?? CONTAS_NAV[0];

  return (
    <PageShell className="h-full space-y-6">
      <PageHeader
        title="Contas a pagar"
        description={activeNav.description}
        icon={TrendingDown}
        className="gap-2 sm:items-center"
      />

      <div className="flex h-full flex-col gap-6 md:flex-row md:items-start">
        <aside className="h-full w-full shrink-0 border-b border-border pb-4 md:w-56 md:border-b-0 md:border-r md:pb-0 md:pr-4">
          <nav
            className="flex h-full gap-2 md:flex-col md:gap-1"
            aria-label="Seções de contas a pagar"
          >
            {CONTAS_NAV.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "flex min-w-0 flex-1 items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors md:flex-none",
                      isActive
                        ? "border-border bg-background text-foreground shadow-sm"
                        : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )
                  }
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {item.label}
                    </span>
                  </span>
                </NavLink>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          <FluxoBoletosPage
            config={CONTAS_A_PAGAR_FLUXO_CONFIG}
            embedded
            section={section}
          />
        </div>
      </div>
    </PageShell>
  );
}

import { VENDAS_REALIZADAS_FLUXO_CONFIG } from "@/components/fluxo/fluxoBoletosConfigs";
import { FluxoBoletosPage } from "@/components/fluxo/FluxoBoletosPage";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { ExportButton } from "@/components/reports/ExportButton";
import { VendasRealizadasResumo } from "@/components/revenue/VendasRealizadasResumo";
import { cn } from "@/lib/utils";
import { CmvMargens } from "@/pages/CmvMargens";
import { FaturamentoEpoc } from "@/pages/FaturamentoEpoc";
import {
  CalendarDays,
  LayoutDashboard,
  List,
  Percent,
  Receipt,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { NavLink, Navigate, Outlet, useLocation, useSearchParams } from "react-router-dom";

const VENDAS_NAV: {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  description: string;
}[] = [
  {
    to: "/app/vendas-realizadas",
    label: "Resumo",
    icon: LayoutDashboard,
    end: true,
    description:
      "Panorama das vendas do período e comparação com o intervalo anterior.",
  },
  {
    to: "/app/vendas-realizadas/calendario",
    label: "Calendário",
    icon: CalendarDays,
    description:
      "Entradas previstas: calendário de recebimentos ou lista do mês.",
  },
  {
    to: "/app/vendas-realizadas/faturamento",
    label: "Faturamento",
    icon: Receipt,
    description:
      "Resumo diário do relatório de faturamento EPOC (Total Geral, produtos/serviços, fiscal e formas de pagamento).",
  },
  {
    to: "/app/vendas-realizadas/margens",
    label: "Margens",
    icon: Percent,
    description: "Custo, markup e margem por produto — e lacunas de CMV.",
  },
];

function activeVendasItem(pathname: string) {
  return (
    VENDAS_NAV.find((item) =>
      item.end
        ? pathname === item.to
        : pathname === item.to || pathname.startsWith(`${item.to}/`),
    ) ?? VENDAS_NAV[0]
  );
}

/** Layout de vendas realizadas com sidebar, no mesmo padrão de Configurações. */
export function VendasRealizadasFluxo() {
  const { pathname } = useLocation();
  const active = activeVendasItem(pathname);
  const reportId =
    pathname.includes("/faturamento")
      ? ("epoc_billing" as const)
      : pathname.includes("/margens")
        ? ("cmv_margins" as const)
        : ("sales_summary" as const);
  const showHeaderExport = !pathname.includes("/calendario");

  return (
    <PageShell className="h-full space-y-6">
      <PageHeader
        title="Vendas realizadas"
        description={active.description}
        icon={TrendingUp}
        action={showHeaderExport ? <ExportButton reportId={reportId} /> : undefined}
      />

      <div className="flex h-full flex-col gap-6 md:flex-row md:items-start">
        <aside className="h-full w-full shrink-0 border-b border-border pb-4 md:w-56 md:border-b-0 md:border-r md:pb-0 md:pr-4">
          <nav
            className="flex h-full gap-2 md:flex-col md:gap-1"
            aria-label="Seções de vendas realizadas"
          >
            {VENDAS_NAV.map((item) => {
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

        <div className="min-w-0 flex-1 space-y-6">
          <Outlet />
        </div>
      </div>
    </PageShell>
  );
}

/** Mantém links antigos `?tab=` e mostra o resumo na raiz. */
export function VendasRealizadasIndex() {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab");
  if (tab === "calendario" || tab === "faturamento" || tab === "margens") {
    return <Navigate to={`/app/vendas-realizadas/${tab}`} replace />;
  }
  return <VendasRealizadasResumo />;
}

const CALENDARIO_HOME = "/app/vendas-realizadas/calendario";
const CALENDARIO_LIST = "/app/vendas-realizadas/calendario/listagem";

export function VendasRealizadasCalendario() {
  const { pathname } = useLocation();
  const section = pathname.endsWith("/listagem") ? "list" : "calendar";

  return (
    <div className="space-y-6">
      <nav
        className="flex flex-wrap gap-2 border-b border-border pb-px"
        aria-label="Abas de calendário"
      >
        <NavLink
          to={CALENDARIO_HOME}
          end
          className={({ isActive }) =>
            cn(
              "inline-flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "border-border bg-background text-foreground shadow-sm"
                : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )
          }
        >
          <CalendarDays className="h-4 w-4 shrink-0" />
          Calendário
        </NavLink>
        <NavLink
          to={CALENDARIO_LIST}
          className={({ isActive }) =>
            cn(
              "inline-flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "border-border bg-background text-foreground shadow-sm"
                : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )
          }
        >
          <List className="h-4 w-4 shrink-0" />
          Listagem
        </NavLink>
      </nav>
      <FluxoBoletosPage
        config={VENDAS_REALIZADAS_FLUXO_CONFIG}
        embedded
        section={section}
      />
    </div>
  );
}

export function VendasRealizadasFaturamento() {
  return <FaturamentoEpoc embedded />;
}

export function VendasRealizadasMargens() {
  return <CmvMargens embedded />;
}

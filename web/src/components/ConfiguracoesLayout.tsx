import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompany, useHasPermission } from "@/contexts/CompanyContext";
import { useUnitSetupModal } from "@/contexts/UnitSetupModalContext";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  Building,
  Building2,
  CalendarRange,
  CreditCard,
  FolderTree,
  Landmark,
  MessageCircle,
  Percent,
  Plug,
  Settings2,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

type ConfigLink = {
  to: string;
  label: string;
  icon: LucideIcon;
  ownerOnly?: boolean;
};

const CONFIG_GROUPS: {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  links: ConfigLink[];
}[] = [
  {
    id: "unidade",
    label: "Unidade",
    description: "Acessos e canais da empresa",
    icon: Building,
    links: [
      {
        to: "/app/configuracoes/usuarios",
        label: "Usuários e acessos",
        icon: Users,
      },
      {
        to: "/app/configuracoes/whatsapp",
        label: "WhatsApp",
        icon: MessageCircle,
      },
    ],
  },
  {
    id: "integracoes",
    label: "Integrações",
    description: "Focus, EPOC e sistemas externos",
    icon: Plug,
    links: [
      {
        to: "/app/configuracoes/integracoes",
        label: "Sistemas",
        icon: Plug,
      },
    ],
  },
  {
    id: "financeiro",
    label: "Financeiro",
    description: "Contas, pagamentos e regras",
    icon: Wallet,
    links: [
      {
        to: "/app/configuracoes/contas-bancarias",
        label: "Contas bancárias",
        icon: Landmark,
      },
      {
        to: "/app/configuracoes/adquirentes",
        label: "Adquirentes",
        icon: Building2,
      },
      {
        to: "/app/configuracoes/formas-de-pagamento",
        label: "Formas de pagamento",
        icon: CreditCard,
      },
      {
        to: "/app/configuracoes/impostos-receita",
        label: "Impostos na receita",
        icon: Percent,
      },
      {
        to: "/app/configuracoes/semana-contabil",
        label: "Semana contábil",
        icon: CalendarRange,
      },
      {
        to: "/app/configuracoes/categorias",
        label: "Categorias",
        icon: FolderTree,
      },
    ],
  },
];

function ConfigTabLink({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <NavLink
      to={to}
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
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </NavLink>
  );
}

export function ConfiguracoesLayout() {
  const { currentCompany, refetchCompanies, isCompanyOwner } = useCompany();
  const canConfig = useHasPermission("configuracoes");
  const canIntegracoes = useHasPermission("integracoes");
  const { openModal } = useUnitSetupModal();
  const location = useLocation();
  const navigate = useNavigate();
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const visibleGroups = useMemo(
    () =>
      CONFIG_GROUPS.map((group) => ({
        ...group,
        links: group.links.filter((link) => {
          if (link.ownerOnly && !isCompanyOwner) return false;
          if (!canConfig && canIntegracoes) {
            return link.to === "/app/configuracoes/integracoes";
          }
          return true;
        }),
      })).filter((group) => group.links.length > 0),
    [canConfig, canIntegracoes, isCompanyOwner],
  );

  if (!canConfig && !canIntegracoes && !isCompanyOwner) {
    return (
      <div className="mx-auto max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" />
              Configurações
            </CardTitle>
            <CardDescription>
              Você não tem permissão para acessar as configurações desta
              unidade.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const activeGroup =
    visibleGroups.find((group) =>
      group.links.some(
        (link) =>
          location.pathname === link.to ||
          location.pathname.startsWith(`${link.to}/`),
      ),
    ) ?? visibleGroups[0];

  return (
    <PageShell className="space-y-6 h-full">
      <PageHeader
        icon={Settings2}
        title="Configurações"
        description="Ajustes da unidade, integrações e cadastro financeiro."
      />

      <div className="flex flex-col gap-6 md:flex-row md:items-start h-full">
        <aside className="w-full shrink-0 border-b border-border pb-4 md:w-56 md:border-b-0 md:border-r md:pb-0 md:pr-4  h-full">
          <nav
            className="flex gap-2 md:flex-col md:gap-1 h-full"
            aria-label="Áreas de configuração"
          >
            {visibleGroups.map((group) => {
              const Icon = group.icon;
              const isActive = group.id === activeGroup?.id;
              const first = group.links[0];
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => {
                    if (!isActive && first) navigate(first.to);
                  }}
                  className={cn(
                    "flex min-w-0 flex-1 items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors md:flex-none",
                    isActive
                      ? "border-border bg-background text-foreground shadow-sm"
                      : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {group.label}
                    </span>
                    {/* <span className="mt-0.5 hidden text-xs text-muted-foreground md:block">
                      {group.description}
                    </span> */}
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 space-y-6">
          {activeGroup && activeGroup.links.length > 1 ? (
            <nav
              className="flex flex-wrap gap-2 border-b border-border pb-px"
              aria-label={`Abas de ${activeGroup.label}`}
            >
              {activeGroup.links.map((link) => (
                <ConfigTabLink key={link.to} {...link} />
              ))}
            </nav>
          ) : null}

          {/* <Card className="border-amber-500/40 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <RotateCcw className="h-4 w-4" />
            Setup inicial
          </CardTitle>
          <CardDescription>
            Reinicie o onboarding da unidade atual e reabra o assistente no
            passo 1.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="border-amber-500/40"
            onClick={() => setResetOpen(true)}
            disabled={!currentCompany || resetting}
          >
            Reiniciar setup inicial
          </Button>
        </CardContent>
      </Card> */}

          <Outlet />
        </div>
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reiniciar setup inicial?</DialogTitle>
            <DialogDescription>
              Isso vai reiniciar o estado do onboarding desta unidade para o
              passo 1. Você poderá preencher novamente as etapas pelo wizard.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResetOpen(false)}
              disabled={resetting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={!currentCompany || resetting}
              onClick={async () => {
                if (!currentCompany) return;
                setResetting(true);
                const now = new Date().toISOString();
                const { error } = await supabase
                  .from("companies")
                  .update({
                    setup: {
                      status: "not_started",
                      setup_schema_version: 6,
                      current_step: 1,
                      completed_steps: [],
                      skipped_steps: [],
                      progress_percent: 0,
                      started_at: now,
                      updated_at: now,
                      completed_at: null,
                      last_paused_at: null,
                      certificate: { status: "not_sent" },
                      xml_zip_import: { phase: "idle", file_log: [] },
                      epoc: { mode: "undecided" },
                    },
                  })
                  .eq("id", currentCompany.id);
                setResetting(false);
                if (error) {
                  toast.error(error.message);
                  return;
                }
                await refetchCompanies();
                setResetOpen(false);
                toast.success("Setup reiniciado.");
                openModal({ kind: "resume", companyId: currentCompany.id });
              }}
            >
              {resetting ? "Reiniciando..." : "Confirmar reinício"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

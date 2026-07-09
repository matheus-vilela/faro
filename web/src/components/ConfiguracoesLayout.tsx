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
import { useCompany } from "@/contexts/CompanyContext";
import { useUnitSetupModal } from "@/contexts/UnitSetupModalContext";
import { canOwnerAccess } from "@/lib/roles";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  FileKey,
  FolderTree,
  Landmark,
  MessageCircle,
  Percent,
  Settings2,
  Users,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { toast } from "sonner";

const SUB_LINKS = [
  {
    to: "/app/configuracoes/usuarios-membros",
    label: "Usuários e membros",
    icon: Users,
  },
  {
    to: "/app/configuracoes/whatsapp",
    label: "WhatsApp",
    icon: MessageCircle,
  },
  {
    to: "/app/configuracoes/categorias",
    label: "Categorias",
    icon: FolderTree,
  },
  {
    to: "/app/configuracoes/contas-bancarias",
    label: "Contas bancárias",
    icon: Landmark,
  },
  {
    to: "/app/configuracoes/impostos-receita",
    label: "Impostos na receita",
    icon: Percent,
  },
  {
    to: "/app/configuracoes/fiscal",
    label: "Fiscal",
    icon: FileKey,
  },
] as const;

export function ConfiguracoesLayout() {
  const { currentRole, currentCompany, refetchCompanies } = useCompany();
  const { openModal } = useUnitSetupModal();
  const isOwner = currentRole ? canOwnerAccess(currentRole) : false;
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  if (!isOwner) {
    return (
      <div className="mx-auto max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5" />
              Configurações
            </CardTitle>
            <CardDescription>
              Apenas o proprietário da empresa pode acessar as configurações.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <PageShell narrow className="space-y-8">
      <PageHeader
        icon={Settings2}
        title="Configurações"
        description="Centralize ajustes da empresa, integrações e permissões."
      />

      <nav
        className="flex flex-wrap gap-2 border-b border-border pb-px"
        aria-label="Seções de configurações"
      >
        {SUB_LINKS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
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
        ))}
      </nav>

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

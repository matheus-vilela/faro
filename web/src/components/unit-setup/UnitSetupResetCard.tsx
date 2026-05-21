import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
import { supabase } from "@/lib/supabase";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function UnitSetupResetCard() {
  const { currentCompany, refetchCompanies } = useCompany();
  const { openModal } = useUnitSetupModal();
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  return (
    <>
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <RotateCcw className="h-4 w-4" />
            Setup inicial
          </CardTitle>
          <CardDescription>
            Reinicie o onboarding da unidade atual e reabra o assistente no passo
            1.
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
      </Card>

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
                      setup_schema_version: 5,
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
    </>
  );
}

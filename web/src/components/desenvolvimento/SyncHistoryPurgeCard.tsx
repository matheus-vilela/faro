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
import { purgeCompanySyncHistory } from "@/services/companySyncHistoryService";
import { AlertTriangle, Eraser, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function SyncHistoryPurgeCard() {
  const { currentCompany, refetchCompanies } = useCompany();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const runPurge = async () => {
    if (!currentCompany) return;
    setRunning(true);
    try {
      const res = await purgeCompanySyncHistory(currentCompany.id);
      if (!res.ok) {
        toast.error(
          res.error === "forbidden"
            ? "Sem permissão para limpar o histórico."
            : res.error,
        );
        return;
      }
      toast.success(
        "Sincronizações interrompidas. Cards de onboarding fiscal e PDV concluídos.",
      );
      setOpen(false);
      await refetchCompanies();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Falha ao limpar o histórico.",
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Card className="border-rose-500/35 bg-rose-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Eraser className="h-4 w-4" />
            Limpar sincronização PDV e fiscal
          </CardTitle>
          <CardDescription>
            Interrompe as filas em curso (NF-e e EPOC) da unidade atual, apaga o
            histórico de sincronização e conclui automaticamente os cards de
            onboarding fiscal e PDV no painel. Não remove notas, XMLs, vendas
            nem despesas já gravadas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            className="gap-2 border-rose-500/40"
            disabled={!currentCompany || running}
            onClick={() => setOpen(true)}
          >
            <Eraser className="h-4 w-4" />
            Limpar histórico de sincronização
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!running) setOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Limpar sincronização PDV e fiscal?</DialogTitle>
            <DialogDescription>
              Serão paradas todas as sincronizações em segundo plano, apagados
              os logs de histórico (consultas NF-e e EPOC) e os cards de
              onboarding fiscal e PDV desta unidade ficarão concluídos. Notas,
              XMLs, vendas e despesas já importadas permanecem.
              {currentCompany ? (
                <span className="mt-2 block font-medium text-foreground">
                  Unidade: {currentCompany.name?.trim() || currentCompany.id}
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-50">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              A ação é irreversível nos logs e nos cards de onboarding. Os
              pipelines em regime (após onboarding) voltam a agendar daqui a
              cerca de 1 hora.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={running}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!currentCompany || running}
              onClick={() => void runPurge()}
            >
              {running ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />A limpar…
                </>
              ) : (
                "Confirmar limpeza"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/contexts/CompanyContext";
import {
  companyPurgeConfirmMatches,
  purgeActiveCompanyOperationalData,
} from "@/services/purgeCompanyOperationalData";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function CompanyOperationalPurgeCard() {
  const { currentCompany, refetchCompanies } = useCompany();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [running, setRunning] = useState(false);
  const companyName = currentCompany?.name?.trim() || "";
  const canConfirm =
    !!currentCompany && companyPurgeConfirmMatches(companyName, confirmName);

  const runPurge = async () => {
    if (!currentCompany || !canConfirm) return;
    setRunning(true);
    try {
      const res = await purgeActiveCompanyOperationalData(
        currentCompany.id,
        confirmName,
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        "Dados da unidade apagados. A empresa e as credenciais EPOC/Focus foram mantidas.",
      );
      setOpen(false);
      setConfirmName("");
      await refetchCompanies();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Falha ao limpar a unidade.",
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Trash2 className="h-4 w-4" />
            Limpar dados da unidade
          </CardTitle>
          <CardDescription>
            Apaga vendas, notas, despesas, boletos, produtos, movimentações,
            contas e o restante criado nesta unidade. Mantém a empresa, o
            acesso à plataforma e as credenciais do EPOC e da Focus.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="destructive"
            className="gap-2"
            disabled={!currentCompany || running}
            onClick={() => {
              setConfirmName("");
              setOpen(true);
            }}
          >
            <Trash2 className="h-4 w-4" />
            Limpar unidade atual
          </Button>
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!running) {
            setOpen(next);
            if (!next) setConfirmName("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Limpar todos os dados desta unidade?</DialogTitle>
            <DialogDescription>
              Ação irreversível. Some o operacional (produtos, estoque,
              financeiro, notas, vendas). Ficam só o cadastro da unidade, os
              usuários/perfis e o acesso EPOC/Focus.
              {companyName ? (
                <span className="mt-2 block font-medium text-foreground">
                  Unidade: {companyName}
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-950 dark:text-amber-50">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              Digite o nome da unidade para confirmar. Arquivos no Storage
              (XMLs) podem ficar órfãos.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="purge-company-name">Nome da unidade</Label>
            <Input
              id="purge-company-name"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={companyName || "Nome da unidade"}
              autoComplete="off"
              disabled={running}
            />
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
              disabled={!canConfirm || running}
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

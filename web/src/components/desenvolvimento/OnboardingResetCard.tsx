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
import {
  resetCompanyOnboardingForDev,
  triggerFiscalOnboardingSyncAfterDevReset,
  triggerPdvOnboardingInitialSyncAfterDevReset,
  type DevOnboardingResetTarget,
} from "@/lib/devOnboardingReset";
import { FileSpreadsheet, Receipt, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

const TARGET_LABELS: Record<
  DevOnboardingResetTarget,
  { title: string; description: string }
> = {
  fiscal: {
    title: "Repor onboarding fiscal?",
    description:
      "Redefine onboarding_fiscal (sync ativo, completed false, contadores zerados), zera o cursor NF-e e inicia de imediato a listagem na SEFAZ. O card de NF-e recebidas volta ao painel.",
  },
  pdv: {
    title: "Repor onboarding PDV?",
    description:
      "Redefine onboarding_pdv (import e vendas zerados, completed false) e inicia de imediato a sincronização onboarding_initial no portal EPOC (mês anterior → ontem). O card de vendas volta ao painel. Mantém setup.epoc (credenciais do wizard).",
  },
  both: {
    title: "Repor onboarding fiscal e PDV?",
    description:
      "Repor fiscal e PDV como acima: dispara listagem SEFAZ e onboarding_initial no EPOC. Inclui limpar o cursor NF-e. Mantém setup.epoc.",
  },
};

export function OnboardingResetCard() {
  const { currentCompany, refetchCompanies } = useCompany();
  const [pendingTarget, setPendingTarget] =
    useState<DevOnboardingResetTarget | null>(null);
  const [resetting, setResetting] = useState(false);

  const runReset = async () => {
    if (!currentCompany || !pendingTarget) return;
    const target = pendingTarget;
    const companyId = currentCompany.id;
    setResetting(true);
    try {
      const { error } = await resetCompanyOnboardingForDev(companyId, target);
      if (error) {
        toast.error(error);
        return;
      }
      await refetchCompanies();
      setPendingTarget(null);

      const touchesFiscal = target === "fiscal" || target === "both";
      const touchesPdv = target === "pdv" || target === "both";
      const started: string[] = [];

      if (touchesFiscal) {
        const fiscal = await triggerFiscalOnboardingSyncAfterDevReset(companyId);
        if (fiscal.started) {
          started.push("SEFAZ");
        } else {
          toast.warning(
            fiscal.error ??
              "Onboarding fiscal reposto, mas a sincronização SEFAZ não foi iniciada.",
            { duration: 8000 },
          );
        }
      }
      if (touchesPdv) {
        const sync = await triggerPdvOnboardingInitialSyncAfterDevReset(companyId);
        if (sync.started) {
          started.push("EPOC");
        } else {
          toast.warning(
            sync.error ??
              "Onboarding PDV reposto, mas a sincronização EPOC não foi iniciada.",
            { duration: 8000 },
          );
        }
      }

      if (started.length) {
        toast.success(
          `Onboarding reposto. Sincronização ${started.join(" e ")} iniciada em segundo plano — acompanhe no painel.`,
          { duration: 6000 },
        );
      } else if (!touchesFiscal && !touchesPdv) {
        toast.success("Onboarding reposto. Confira os cards no painel.");
      }
    } finally {
      setResetting(false);
    }
  };

  const disabled = !currentCompany || resetting;

  return (
    <>
      <Card className="border-violet-500/35 bg-violet-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <RotateCcw className="h-4 w-4" />
            Onboarding fiscal e PDV
          </CardTitle>
          <CardDescription>
            Repõe os JSON{" "}
            <code className="rounded bg-muted px-1 text-xs">
              onboarding_fiscal
            </code>{" "}
            e/ou{" "}
            <code className="rounded bg-muted px-1 text-xs">onboarding_pdv</code>{" "}
            da unidade atual para testar de novo os fluxos exibidos no painel
            (NF-e Focus e vendas EPOC). O reset fiscal também zera o cursor em{" "}
            <code className="rounded bg-muted px-1 text-xs">focusnfe</code>{" "}
            e dispara a listagem na SEFAZ. Não reinicia o wizard nem limpa{" "}
            <code className="rounded bg-muted px-1 text-xs">setup.epoc</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={disabled}
            onClick={() => setPendingTarget("fiscal")}
          >
            <Receipt className="h-4 w-4" />
            Repor onboarding fiscal
          </Button>
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            disabled={disabled}
            onClick={() => setPendingTarget("pdv")}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Repor onboarding PDV
          </Button>
          <Button
            type="button"
            variant="outline"
            className="gap-2 border-violet-500/40"
            disabled={disabled}
            onClick={() => setPendingTarget("both")}
          >
            <RotateCcw className="h-4 w-4" />
            Repor os dois
          </Button>
          {currentCompany ? (
            <Button type="button" variant="ghost" className="sm:ml-auto" asChild>
              <Link to="/app/dashboard">Abrir painel</Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={pendingTarget != null}
        onOpenChange={(open) => {
          if (!open && !resetting) setPendingTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingTarget ? TARGET_LABELS[pendingTarget].title : ""}
            </DialogTitle>
            <DialogDescription>
              {pendingTarget ? TARGET_LABELS[pendingTarget].description : ""}
              {currentCompany ? (
                <span className="mt-2 block font-medium text-foreground">
                  Unidade: {currentCompany.name?.trim() || currentCompany.id}
                </span>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingTarget(null)}
              disabled={resetting}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!currentCompany || resetting}
              onClick={() => void runReset()}
            >
              {resetting ? "Repondo..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

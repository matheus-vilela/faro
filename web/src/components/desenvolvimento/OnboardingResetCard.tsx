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
      "Redefine onboarding_fiscal (sync ativo, completed false, contadores zerados) e remove nfes_recebidas_ultima_versao e nfes_recebidas_ultima_sync_at de focusnfe. O card de NF-e recebidas volta a aparecer no painel para testar o fluxo fiscal do zero.",
  },
  pdv: {
    title: "Repor onboarding PDV?",
    description:
      "Redefine onboarding_pdv (sync ativo, import e vendas zerados, completed false). O card de vendas EPOC volta a aparecer no painel para testar o fluxo PDV. Mantém setup.epoc (credenciais/modo PDV do wizard).",
  },
  both: {
    title: "Repor onboarding fiscal e PDV?",
    description:
      "Aplica as duas reposições acima na unidade selecionada (inclui limpar o cursor NF-e em focusnfe). Use para reiniciar os dois fluxos de onboarding no dashboard. Mantém setup.epoc.",
  },
};

export function OnboardingResetCard() {
  const { currentCompany, refetchCompanies } = useCompany();
  const [pendingTarget, setPendingTarget] =
    useState<DevOnboardingResetTarget | null>(null);
  const [resetting, setResetting] = useState(false);

  const runReset = async () => {
    if (!currentCompany || !pendingTarget) return;
    setResetting(true);
    const { error } = await resetCompanyOnboardingForDev(
      currentCompany.id,
      pendingTarget,
    );
    setResetting(false);
    if (error) {
      toast.error(error);
      return;
    }
    await refetchCompanies();
    setPendingTarget(null);
    toast.success("Onboarding reposto. Confira os cards no painel.");
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
            (versão e última sync de NF-e recebidas). Não reinicia o wizard nem
            limpa <code className="rounded bg-muted px-1 text-xs">setup.epoc</code>.
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

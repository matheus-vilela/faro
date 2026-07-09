import { stepStatus } from "@/lib/setup/setupProgress";
import { cn } from "@/lib/utils";
import type { CompanySetupMap, SetupStepNumber } from "@/types/companySetup";

export const GROUP_STEP_LABEL = "Grupo";
export const GROUP_STEP_HINT =
  "Crie o grupo que reunirá as unidades da sua operação.";

/** Rótulos curtos exibidos no trilho de etapas (passos de unidade, fiscal e PDV). */
export const SETUP_STEP_LABELS: Record<SetupStepNumber, string> = {
  1: "Unidade",
  2: "Fiscal",
  3: "Suas Vendas",
  4: "WhatsApp",
};

/** Uma linha de contexto para o cabeçalho da página (etapa atual). */
export const SETUP_STEP_HINTS: Record<SetupStepNumber, string> = {
  1: "CNPJ, nome fantasia e dados da unidade (endereço pela validação do CNPJ).",
  2: "Conecte a SEFAZ uma vez. Toda nota emitida contra seu CNPJ entra sozinha no contas a pagar.",
  3: "O Faro puxa suas vendas todo dia. Sem digitar nada. É isso que destrava o CMV real.",
  4: "Alertas de vencimento, resumo semanal e envio de notas por foto. Tudo pelo WhatsApp.",
};

export function wizardStepCount(includeGroupStep: boolean): number {
  return includeGroupStep ? 5 : 4;
}

export function wizardStepLabel(
  wizardStep: number,
  includeGroupStep: boolean,
): string {
  if (includeGroupStep && wizardStep === 1) return GROUP_STEP_LABEL;
  const setupStep = (
    includeGroupStep ? wizardStep - 1 : wizardStep
  ) as SetupStepNumber;
  return SETUP_STEP_LABELS[setupStep];
}

export function wizardStepHint(
  wizardStep: number,
  includeGroupStep: boolean,
): string {
  if (includeGroupStep && wizardStep === 1) return GROUP_STEP_HINT;
  const setupStep = (
    includeGroupStep ? wizardStep - 1 : wizardStep
  ) as SetupStepNumber;
  return SETUP_STEP_HINTS[setupStep];
}

/** Título principal do cabeçalho do wizard (varia no passo fiscal). */
export function wizardPageTitle(
  wizardStep: number,
  includeGroupStep: boolean,
): string {
  const setupStep = (
    includeGroupStep ? wizardStep - 1 : wizardStep
  ) as SetupStepNumber;
  if (setupStep === 2) return "Deixe o Faro farejar suas notas";
  if (setupStep === 3) return "Conecte seu ponto de venda";
  if (setupStep === 4) return "Onde o Faro fala com você";
  return "Configurar unidade";
}

function wizardSteps(includeGroupStep: boolean): number[] {
  const count = wizardStepCount(includeGroupStep);
  return Array.from({ length: count }, (_, i) => i + 1);
}

function wizardStepStatus(
  wizardStep: number,
  includeGroupStep: boolean,
  setup: CompanySetupMap,
  activeWizardStep: number,
): ReturnType<typeof stepStatus> {
  if (includeGroupStep && wizardStep === 1) {
    if (activeWizardStep > 1) return "done";
    if (activeWizardStep === 1) return "current";
    return "pending";
  }
  const setupStep = (
    includeGroupStep ? wizardStep - 1 : wizardStep
  ) as SetupStepNumber;
  const setupActive = includeGroupStep
    ? activeWizardStep - 1
    : activeWizardStep;
  return stepStatus(setupStep, setup, setupActive);
}

function isBarFilled(st: ReturnType<typeof stepStatus>): boolean {
  return st === "done" || st === "skipped" || st === "current";
}

export function SetupStepper({
  activeStep,
  setup,
  includeGroupStep = false,
}: {
  activeStep: number;
  setup: CompanySetupMap;
  /** Passo inicial só para criação de grupo (novo grupo). */
  includeGroupStep?: boolean;
}) {
  const steps = wizardSteps(includeGroupStep);
  const trailSteps = wizardStepCount(includeGroupStep);

  return (
    <div
      className="flex w-full min-w-0 gap-1.5"
      role="group"
      aria-label={`Passo ${activeStep} de ${trailSteps}`}
    >
      {steps.map((n) => {
        const st = wizardStepStatus(n, includeGroupStep, setup, activeStep);
        return (
          <div
            key={n}
            className={cn(
              "h-1.5 min-w-0 flex-1 rounded-full transition-colors duration-300",
              isBarFilled(st) ? "bg-primary" : "bg-muted",
            )}
            aria-hidden
          />
        );
      })}
    </div>
  );
}

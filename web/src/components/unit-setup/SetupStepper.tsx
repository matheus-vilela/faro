import { stepStatus } from "@/lib/setup/setupProgress";
import { cn } from "@/lib/utils";
import type { CompanySetupMap, SetupStepNumber } from "@/types/companySetup";
import { Check, Minus } from "lucide-react";
import { Fragment } from "react";

/** Rótulos curtos exibidos no trilho de etapas. */
export const SETUP_STEP_LABELS: Record<SetupStepNumber, string> = {
  1: "Empresa",
  2: "Fiscal",
  3: "PDV",
};

/** Uma linha de contexto para o cabeçalho da página (etapa atual). */
export const SETUP_STEP_HINTS: Record<SetupStepNumber, string> = {
  1: "Dados da empresa, CNPJ e endereço (preenchidos na validação).",
  2: "Certificado digital A1 usado na emissão fiscal.",
  3: "Integração de PDV com a operação da unidade.",
};

const STEPS: readonly SetupStepNumber[] = [1, 2, 3];
const TRAIL_STEPS = 3;

function StepCircle({
  n,
  st,
}: {
  n: SetupStepNumber;
  st: ReturnType<typeof stepStatus>;
}) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors",
        st === "current" && "border-primary bg-primary/10 text-primary",
        st === "done" && "border-primary/50 bg-primary text-primary-foreground",
        st === "skipped" &&
          "border-muted-foreground/40 bg-muted text-muted-foreground",
        st === "pending" && "border-muted bg-muted/30 text-muted-foreground",
      )}
    >
      {st === "done" ? (
        <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden />
      ) : st === "skipped" ? (
        <Minus className="h-3.5 w-3.5" aria-hidden />
      ) : (
        n
      )}
    </span>
  );
}

export function SetupStepper({
  activeStep,
  setup,
  companyId,
  lockStepsOneToTwo,
  onStepClick,
}: {
  activeStep: number;
  setup: CompanySetupMap;
  companyId: string | null;
  lockStepsOneToTwo?: boolean;
  onStepClick?: (step: SetupStepNumber) => void;
}) {
  const pct = Math.min(100, Math.max(0, setup.progress_percent ?? 0));
  const interactive = !!onStepClick;
  const locked12 = lockStepsOneToTwo === true;

  const stepEnabled = (n: SetupStepNumber) => {
    if (locked12 && n <= 2) return false;
    if (n === 1) return true;
    return !!companyId;
  };

  return (
    <div className="space-y-4">
      <div
        className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"
        role="status"
        aria-label={`Configuração ${pct.toFixed(0)} por cento concluída`}
      >
        <div>
          <p className="text-sm font-medium text-foreground">Andamento geral</p>
          <p className="text-xs text-muted-foreground">
            Conclua cada etapa — você pode pausar após o certificado.
          </p>
        </div>
        <p className="text-2xl font-semibold tabular-nums text-foreground sm:text-right">
          {pct.toFixed(0)}
          <span className="text-base font-medium text-muted-foreground">%</span>
        </p>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div
        className="w-full min-w-0"
        role="navigation"
        aria-label="Etapas do assistente"
      >
        <div className="flex w-full min-w-0 items-start justify-between">
          {STEPS.map((n, i) => {
            const st = stepStatus(n, setup, activeStep);
            const enabled = stepEnabled(n);
            const canClick = interactive && enabled;
            const beforeSt =
              i > 0 ? stepStatus(STEPS[i - 1]!, setup, activeStep) : null;
            const lineComplete = beforeSt === "done" || beforeSt === "skipped";

            const labelClass = cn(
              "mt-1.5 block w-full text-center text-[10px] font-medium leading-tight sm:text-xs",
              st === "current" && "text-foreground",
              st === "done" && "text-muted-foreground",
              st === "skipped" &&
                "text-muted-foreground line-through decoration-muted-foreground/50",
              st === "pending" && "text-muted-foreground/80",
            );

            return (
              <Fragment key={n}>
                {i > 0 ? (
                  <div
                    className={cn(
                      "mx-0.5 mt-[15px] h-0.5 min-w-0 flex-1 shrink self-start rounded-full transition-colors",
                      lineComplete ? "bg-primary/55" : "bg-border",
                    )}
                    aria-hidden
                  />
                ) : null}
                <div className="flex w-11 shrink-0 flex-col items-center sm:w-14">
                  {interactive ? (
                    <button
                      type="button"
                      disabled={!enabled}
                      onClick={() => enabled && onStepClick?.(n)}
                      className={cn(
                        "group flex w-full flex-col items-center rounded-lg py-0.5 transition-colors",
                        canClick &&
                          "hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        interactive &&
                          !enabled &&
                          "cursor-not-allowed opacity-50",
                      )}
                      aria-current={st === "current" ? "step" : undefined}
                      aria-label={`${SETUP_STEP_LABELS[n]}, etapa ${n} de ${TRAIL_STEPS}${
                        !enabled ? " (indisponível)" : ""
                      }`}
                    >
                      <StepCircle n={n} st={st} />
                      <span className={labelClass}>{SETUP_STEP_LABELS[n]}</span>
                    </button>
                  ) : (
                    <div
                      className="flex w-full flex-col items-center py-0.5"
                      aria-current={st === "current" ? "step" : undefined}
                    >
                      <StepCircle n={n} st={st} />
                      <span className={labelClass}>{SETUP_STEP_LABELS[n]}</span>
                    </div>
                  )}
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

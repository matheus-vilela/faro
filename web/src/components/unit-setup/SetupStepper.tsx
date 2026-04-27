import { cn } from "@/lib/utils";
import type { CompanySetupMap } from "@/types/companySetup";
import { stepStatus } from "@/lib/setup/setupProgress";
import type { SetupStepNumber } from "@/types/companySetup";
import { Check, Circle, Minus } from "lucide-react";

const LABELS: Record<SetupStepNumber, string> = {
  1: "Empresa",
  2: "Endereço",
  3: "Certificado",
  4: "XML / ZIP",
  5: "PDV",
};

function StepRowVisual({
  n,
  st,
}: {
  n: SetupStepNumber;
  st: ReturnType<typeof stepStatus>;
}) {
  return (
    <>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-background text-xs font-medium">
        {st === "done" ? (
          <Check className="h-4 w-4 text-primary" aria-hidden />
        ) : st === "skipped" ? (
          <Minus className="h-4 w-4 text-muted-foreground" aria-hidden />
        ) : st === "current" ? (
          <Circle className="h-4 w-4 fill-primary text-primary" aria-hidden />
        ) : (
          <span>{n}</span>
        )}
      </span>
      <span className="min-w-0 truncate">{LABELS[n]}</span>
    </>
  );
}

export function SetupStepper({
  activeStep,
  setup,
  companyId,
  lockStepsOneToThree,
  onStepClick,
}: {
  activeStep: number;
  setup: CompanySetupMap;
  /** Após criar a unidade no passo 1, permite ir aos passos 2–7. */
  companyId: string | null;
  /**
   * Quando a unidade já foi criada na Faro e o fluxo passou do certificado (`current_step >= 4`),
   * os passos 1–3 ficam somente leitura.
   */
  lockStepsOneToThree?: boolean;
  onStepClick?: (step: SetupStepNumber) => void;
}) {
  const pct = Math.min(100, Math.max(0, setup.progress_percent ?? 0));
  const interactive = !!onStepClick;
  const locked123 = lockStepsOneToThree === true;

  const stepEnabled = (n: SetupStepNumber) => {
    if (locked123 && n <= 3) return false;
    if (n === 1) return true;
    return !!companyId;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium text-muted-foreground">Progresso</span>
        <span className="tabular-nums font-semibold">{pct.toFixed(0)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
        {([1, 2, 3, 4, 5] as const).map((n) => {
          const st = stepStatus(n, setup, activeStep);
          const enabled = stepEnabled(n);
          const canClick = interactive && enabled;

          const baseClass = cn(
            "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
            st === "current" && "border-primary bg-primary/5",
            st === "done" && "border-muted-foreground/30 bg-muted/40",
            st === "skipped" && "border-dashed border-muted-foreground/40",
            st === "pending" && "border-transparent bg-muted/20",
            canClick &&
              "cursor-pointer hover:border-primary/50 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            interactive && !enabled && "cursor-not-allowed opacity-60",
          );

          return (
            <li key={n} className="min-w-0">
              {interactive ? (
                <button
                  type="button"
                  disabled={!enabled}
                  className={baseClass}
                  onClick={() => enabled && onStepClick?.(n)}
                  aria-current={st === "current" ? "step" : undefined}
                  aria-label={`${LABELS[n]}, etapa ${n} de 5`}
                >
                  <StepRowVisual n={n} st={st} />
                </button>
              ) : (
                <div
                  className={baseClass}
                  aria-current={st === "current" ? "step" : undefined}
                >
                  <StepRowVisual n={n} st={st} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

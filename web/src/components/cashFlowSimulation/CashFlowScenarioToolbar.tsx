import { Button } from "@/components/ui/button";
import { SCENARIO_OPTIONS } from "@/lib/cashFlowSimulation/scenarioPresets";
import type { HorizonWeeks, ScenarioKey } from "@/lib/cashFlowSimulation/types";
import { cn } from "@/lib/utils";

const HORIZON_OPTIONS: { value: HorizonWeeks; label: string }[] = [
  { value: 4, label: "4 sem" },
  { value: 8, label: "8 sem" },
  { value: 12, label: "12 sem" },
];

export function CashFlowScenarioToolbar({
  scenario,
  horizonWeeks,
  onScenarioChange,
  onHorizonChange,
  disabled,
}: {
  scenario: ScenarioKey;
  horizonWeeks: HorizonWeeks;
  onScenarioChange: (value: ScenarioKey) => void;
  onHorizonChange: (value: HorizonWeeks) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div
        className="inline-flex w-fit max-w-full flex-wrap rounded-full bg-muted p-1"
        role="tablist"
        aria-label="Cenário de simulação"
      >
        {SCENARIO_OPTIONS.map((opt) => {
          const active = scenario === opt.value;
          return (
            <Button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={active}
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onScenarioChange(opt.value)}
              className={cn(
                "rounded-full px-4",
                active && "bg-background shadow-sm",
              )}
              title={opt.description}
            >
              {opt.label}
            </Button>
          );
        })}
      </div>

      <div
        className="inline-flex w-fit max-w-full flex-wrap rounded-full bg-muted p-1"
        role="tablist"
        aria-label="Horizonte de projeção"
      >
        {HORIZON_OPTIONS.map((opt) => {
          const active = horizonWeeks === opt.value;
          return (
            <Button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={active}
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onHorizonChange(opt.value)}
              className={cn(
                "rounded-full px-4",
                active && "bg-background shadow-sm",
              )}
            >
              {opt.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

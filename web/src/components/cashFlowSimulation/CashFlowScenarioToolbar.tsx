import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  const activeScenario = SCENARIO_OPTIONS.find((o) => o.value === scenario);

  return (
    <div className="space-y-2">
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div
        className="inline-flex w-fit max-w-full flex-wrap rounded-full bg-muted p-1"
        role="tablist"
        aria-label="Cenário de simulação"
      >
        {SCENARIO_OPTIONS.map((opt) => {
          const active = scenario === opt.value;
          return (
            <Tooltip key={opt.value}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={`${opt.label}: ${opt.tooltip}`}
                  variant="ghost"
                  size="sm"
                  onClick={() => onScenarioChange(opt.value)}
                  className={cn(
                    "rounded-full px-4",
                    active && "bg-background shadow-sm",
                  )}
                >
                  {opt.label}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-left">
                {opt.tooltip}
              </TooltipContent>
            </Tooltip>
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
    {activeScenario ? (
      <p className="text-xs text-muted-foreground">{activeScenario.description}</p>
    ) : null}
    </div>
  );
}

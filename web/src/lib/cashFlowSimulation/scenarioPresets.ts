import { addDaysYmd } from "@/lib/payableTotals";
import type { CashFlowDirection, ScenarioKey } from "./types";

export type ScenarioOffsets = {
  receivableDays: number;
  payableDays: number;
};

const SCENARIO_OFFSETS: Record<ScenarioKey, ScenarioOffsets> = {
  base: { receivableDays: 0, payableDays: 0 },
  optimistic: { receivableDays: -3, payableDays: 5 },
  pessimistic: { receivableDays: 7, payableDays: 0 },
};

export const SCENARIO_OPTIONS: {
  value: ScenarioKey;
  label: string;
  description: string;
}[] = [
  {
    value: "base",
    label: "Base",
    description: "Vencimentos como cadastrados",
  },
  {
    value: "optimistic",
    label: "Otimista",
    description: "Recebimentos antecipados e pagamentos postergados",
  },
  {
    value: "pessimistic",
    label: "Pessimista",
    description: "Recebimentos com atraso",
  },
];

export function getScenarioOffsets(scenario: ScenarioKey): ScenarioOffsets {
  return SCENARIO_OFFSETS[scenario];
}

export function applyScenarioOffset(
  dueDateYmd: string,
  direction: CashFlowDirection,
  scenario: ScenarioKey,
): string {
  const offsets = getScenarioOffsets(scenario);
  const days =
    direction === "inflow" ? offsets.receivableDays : offsets.payableDays;
  if (days === 0) return dueDateYmd.slice(0, 10);
  return addDaysYmd(dueDateYmd.slice(0, 10), days);
}

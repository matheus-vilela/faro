import { addDaysYmd } from "@/lib/payableTotals";
import type { CashFlowDirection, ScenarioKey } from "./types";

export type ScenarioOffsets = {
  receivableDays: number;
  payableDays: number;
};

/** Folga na busca para contas na borda entrarem ao trocar o cenário (±1 semana). */
export const SCENARIO_FETCH_PADDING_DAYS = 7;

const SCENARIO_OFFSETS: Record<ScenarioKey, ScenarioOffsets> = {
  base: { receivableDays: 0, payableDays: 0 },
  optimistic: { receivableDays: -7, payableDays: 7 },
  pessimistic: { receivableDays: 7, payableDays: -7 },
};

export const SCENARIO_OPTIONS: {
  value: ScenarioKey;
  label: string;
  description: string;
  tooltip: string;
}[] = [
  {
    value: "base",
    label: "Base",
    description: "Vencimentos como cadastrados",
    tooltip:
      "Usa as datas de vencimento cadastradas. É o cenário se tudo for pago e recebido no prazo.",
  },
  {
    value: "optimistic",
    label: "Otimista",
    description: "Recebimentos 7 dias antes e pagamentos 7 dias depois",
    tooltip:
      "Simula caixa mais folgado: recebimentos 7 dias antes e pagamentos 7 dias depois. Mostra o melhor caso de timing.",
  },
  {
    value: "pessimistic",
    label: "Pessimista",
    description: "Recebimentos 7 dias depois e pagamentos 7 dias antes",
    tooltip:
      "Simula pressão de caixa: recebimentos 7 dias depois e pagamentos 7 dias antes. Mostra se o saldo aguenta atraso de cliente e cobrança antecipada.",
  },
];

export function getScenarioOffsets(scenario: ScenarioKey): ScenarioOffsets {
  return SCENARIO_OFFSETS[scenario];
}

export function applyScenarioOffset(
  dueDateYmd: string,
  direction: CashFlowDirection,
  scenario: ScenarioKey,
  todayYmd: string,
): string {
  const offsets = getScenarioOffsets(scenario);
  const days =
    direction === "inflow" ? offsets.receivableDays : offsets.payableDays;
  const base = dueDateYmd.slice(0, 10);
  if (days === 0) return base;
  const simulated = addDaysYmd(base, days);
  const today = todayYmd.slice(0, 10);
  if (simulated < today) return today;
  return simulated;
}

export type CashFlowDirection = "inflow" | "outflow";

export type CashFlowItem = {
  id: string;
  direction: CashFlowDirection;
  amount: number;
  dueDateYmd: string;
  simulatedDateYmd: string;
  description?: string;
  isProjected?: boolean;
};

export type ScenarioKey = "base" | "optimistic" | "pessimistic";

export type HorizonWeeks = 4 | 8 | 12;

export type CashFlowSimulationPrefs = {
  openingBalance: number;
  scenario: ScenarioKey;
  horizonWeeks: HorizonWeeks;
};

export type PeriodBucket = {
  index: number;
  label: string;
  startYmd: string;
  endYmd: string;
  inflows: number;
  outflows: number;
  netFlow: number;
  runningBalance: number;
};

export type CashFlowProjectionKpis = {
  openingBalance: number;
  totalInflows: number;
  totalOutflows: number;
  minBalance: number;
  endingBalance: number;
};

export type CashFlowProjection = {
  buckets: PeriodBucket[];
  kpis: CashFlowProjectionKpis;
};

export const DEFAULT_CASH_FLOW_PREFS: CashFlowSimulationPrefs = {
  openingBalance: 0,
  scenario: "base",
  horizonWeeks: 8,
};

export const CASH_FLOW_PREFS_STORAGE_PREFIX = "faro:cashflow-sim:";

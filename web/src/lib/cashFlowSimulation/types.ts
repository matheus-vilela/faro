export type CashFlowDirection = "inflow" | "outflow";

/** Item bruto vindo do banco (sem offset de cenário). */
export type RawCashFlowItem = {
  id: string;
  direction: CashFlowDirection;
  amount: number;
  dueDateYmd: string;
  description?: string;
  isProjected?: boolean;
};

export type CashFlowItem = RawCashFlowItem & {
  simulatedDateYmd: string;
};

export type CashFlowBucketItem = CashFlowItem & {
  isOverdue: boolean;
  clampedToHorizon: boolean;
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
  items: CashFlowBucketItem[];
};

export type CashFlowProjectionKpis = {
  openingBalance: number;
  totalInflows: number;
  totalOutflows: number;
  minBalance: number;
  endingBalance: number;
};

export type CashFlowProjectionMeta = {
  /** Itens alocados na última semana por extrapolação do cenário. */
  clampedToLastBucketCount: number;
};

export type CashFlowProjection = {
  buckets: PeriodBucket[];
  kpis: CashFlowProjectionKpis;
  meta: CashFlowProjectionMeta;
};

export type CashFlowDiagnostics = {
  pendingInHorizon: number;
  pendingOutsideHorizon: number;
  overduePendingCount: number;
  overduePendingPayablesAmount: number;
  overduePendingReceivablesAmount: number;
};

export type OpeningBalanceHint = {
  paidInflows30: number;
  paidOutflows30: number;
  netPaid30: number;
  overduePendingPayablesAmount: number;
  overduePendingReceivablesAmount: number;
};

export const DEFAULT_CASH_FLOW_PREFS: CashFlowSimulationPrefs = {
  openingBalance: 0,
  scenario: "base",
  horizonWeeks: 8,
};

export const CASH_FLOW_PREFS_STORAGE_PREFIX = "faro:cashflow-sim:";

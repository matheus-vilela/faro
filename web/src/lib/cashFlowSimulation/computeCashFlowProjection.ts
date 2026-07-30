import { addDaysYmd } from "@/lib/payableTotals";
import { applyScenarioOffset } from "./scenarioPresets";
import type {
  CashFlowBucketItem,
  CashFlowDirection,
  CashFlowItem,
  CashFlowProjection,
  HorizonWeeks,
  RawCashFlowItem,
  ScenarioKey,
} from "./types";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymdFromDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Segunda-feira da semana que contém a data (calendário local). */
export function getMondayOfWeekYmd(ymd: string): string {
  const [y, m, day] = ymd.slice(0, 10).split("-").map(Number);
  const d = new Date(y, m - 1, day);
  const weekday = d.getDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  d.setDate(d.getDate() + diff);
  return ymdFromDate(d);
}

export function buildWeeklyBuckets(
  todayYmd: string,
  horizonWeeks: HorizonWeeks,
): { startYmd: string; endYmd: string; label: string }[] {
  const firstMonday = getMondayOfWeekYmd(todayYmd);
  const buckets: { startYmd: string; endYmd: string; label: string }[] = [];

  for (let i = 0; i < horizonWeeks; i++) {
    const startYmd = addDaysYmd(firstMonday, i * 7);
    const endYmd = addDaysYmd(startYmd, 6);
    const [sy, sm, sd] = startYmd.split("-").map(Number);
    const [ey, em, ed] = endYmd.split("-").map(Number);
    const startLabel = new Date(sy, sm - 1, sd).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
    });
    const endLabel = new Date(ey, em - 1, ed).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
    });
    buckets.push({
      startYmd,
      endYmd,
      label: `${startLabel} – ${endLabel}`,
    });
  }

  return buckets;
}

function findBucketIndexInRange(
  dateYmd: string,
  buckets: { startYmd: string; endYmd: string }[],
): number | null {
  for (let i = 0; i < buckets.length; i++) {
    const b = buckets[i];
    if (dateYmd >= b.startYmd && dateYmd <= b.endYmd) return i;
  }
  return null;
}

export function resolveBucketAssignmentYmd(
  simulatedDateYmd: string,
  todayYmd: string,
  firstBucketStartYmd: string,
): string {
  if (simulatedDateYmd < todayYmd) {
    return firstBucketStartYmd;
  }
  return simulatedDateYmd;
}

function resolveBucketIndex(
  assignYmd: string,
  weekDefs: { startYmd: string; endYmd: string }[],
): { index: number; clampedToHorizon: boolean } {
  const inRange = findBucketIndexInRange(assignYmd, weekDefs);
  if (inRange != null) {
    return { index: inRange, clampedToHorizon: false };
  }

  const lastIdx = weekDefs.length - 1;
  if (lastIdx < 0) return { index: 0, clampedToHorizon: false };

  if (assignYmd > weekDefs[lastIdx].endYmd) {
    return { index: lastIdx, clampedToHorizon: true };
  }

  return { index: 0, clampedToHorizon: false };
}

export function toRawCashFlowItem(input: {
  id: string;
  direction: CashFlowDirection;
  amount: number;
  dueDateYmd: string;
  description?: string;
  isProjected?: boolean;
}): RawCashFlowItem {
  return {
    id: input.id,
    direction: input.direction,
    amount: input.amount,
    dueDateYmd: input.dueDateYmd.slice(0, 10),
    description: input.description,
    isProjected: input.isProjected,
  };
}

export function applyScenarioToRawItems(
  items: RawCashFlowItem[],
  scenario: ScenarioKey,
  todayYmd: string,
): CashFlowItem[] {
  return items.map((item) => {
    const due = item.dueDateYmd.slice(0, 10);
    // Vencidas pendentes: simular a partir de hoje para cenários alterarem a semana.
    const anchorYmd = due < todayYmd ? todayYmd : due;
    return {
      ...item,
      simulatedDateYmd: applyScenarioOffset(
        anchorYmd,
        item.direction,
        scenario,
      ),
    };
  });
}

/** @deprecated Use applyScenarioToRawItems + computeCashFlowProjection com rawItems. */
export function toCashFlowItem(input: {
  id: string;
  direction: CashFlowDirection;
  amount: number;
  dueDateYmd: string;
  scenario: ScenarioKey;
  description?: string;
  isProjected?: boolean;
}): CashFlowItem {
  const raw = toRawCashFlowItem(input);
  const todayYmd = input.dueDateYmd.slice(0, 10);
  return applyScenarioToRawItems([raw], input.scenario, todayYmd)[0];
}

export function parseOpeningBalance(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return 0;
  const n =
    typeof raw === "number"
      ? raw
      : parseFloat(String(raw).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function computeCashFlowProjection(input: {
  rawItems: RawCashFlowItem[];
  scenario: ScenarioKey;
  openingBalance: number;
  todayYmd: string;
  horizonWeeks: HorizonWeeks;
}): CashFlowProjection {
  const openingBalance = parseOpeningBalance(input.openingBalance);
  const weekDefs = buildWeeklyBuckets(input.todayYmd, input.horizonWeeks);
  const firstBucketStart = weekDefs[0]?.startYmd ?? input.todayYmd;
  const scenarioItems = applyScenarioToRawItems(
    input.rawItems,
    input.scenario,
    input.todayYmd,
  );

  const inflowsByBucket = new Array(weekDefs.length).fill(0);
  const outflowsByBucket = new Array(weekDefs.length).fill(0);
  const itemsByBucket: CashFlowBucketItem[][] = weekDefs.map(() => []);
  let clampedToLastBucketCount = 0;

  for (const item of scenarioItems) {
    const amount = Number(item.amount) || 0;
    if (amount <= 0) continue;

    const isOverdue = item.dueDateYmd < input.todayYmd;
    const assignYmd = resolveBucketAssignmentYmd(
      item.simulatedDateYmd,
      input.todayYmd,
      firstBucketStart,
    );
    const { index: bucketIdx, clampedToHorizon } = resolveBucketIndex(
      assignYmd,
      weekDefs,
    );

    if (clampedToHorizon) clampedToLastBucketCount += 1;

    const bucketItem: CashFlowBucketItem = {
      ...item,
      isOverdue,
      clampedToHorizon,
    };
    itemsByBucket[bucketIdx].push(bucketItem);

    if (item.direction === "inflow") {
      inflowsByBucket[bucketIdx] += amount;
    } else {
      outflowsByBucket[bucketIdx] += amount;
    }
  }

  for (const bucketItems of itemsByBucket) {
    bucketItems.sort((a, b) => {
      const dateCmp = a.simulatedDateYmd.localeCompare(b.simulatedDateYmd);
      if (dateCmp !== 0) return dateCmp;
      return (a.description ?? "").localeCompare(b.description ?? "");
    });
  }

  let runningBalance = openingBalance;
  let minBalance = openingBalance;
  let totalInflows = 0;
  let totalOutflows = 0;

  const buckets = weekDefs.map((def, index) => {
    const inflows = inflowsByBucket[index];
    const outflows = outflowsByBucket[index];
    const netFlow = inflows - outflows;
    runningBalance += netFlow;
    totalInflows += inflows;
    totalOutflows += outflows;
    if (runningBalance < minBalance) minBalance = runningBalance;

    return {
      index,
      label: def.label,
      startYmd: def.startYmd,
      endYmd: def.endYmd,
      inflows,
      outflows,
      netFlow,
      runningBalance,
      items: itemsByBucket[index],
    };
  });

  return {
    buckets,
    kpis: {
      openingBalance,
      totalInflows,
      totalOutflows,
      minBalance,
      endingBalance: runningBalance,
    },
    meta: {
      clampedToLastBucketCount,
    },
  };
}

export function getCashFlowFetchRange(
  todayYmd: string,
  horizonWeeks: HorizonWeeks,
): { startYmd: string; endYmd: string } {
  const lookbackStart = addDaysYmd(todayYmd, -90);
  const firstMonday = getMondayOfWeekYmd(todayYmd);
  const horizonEnd = addDaysYmd(firstMonday, horizonWeeks * 7 - 1);
  return { startYmd: lookbackStart, endYmd: horizonEnd };
}

import { addDaysYmd } from "@/lib/payableTotals";
import {
  normalizeWeekStartsOn,
  startOfAccountingWeek,
} from "@/lib/vendasRealizadasResumo";
import {
  applyScenarioOffset,
  SCENARIO_FETCH_PADDING_DAYS,
} from "./scenarioPresets";
import type {
  CashFlowBucketItem,
  CashFlowDirection,
  CashFlowItem,
  CashFlowProjection,
  HorizonWeeks,
  RawCashFlowItem,
  ScenarioKey,
} from "./types";

/** @deprecated Prefer startOfAccountingWeek com weekStartsOn da unidade. */
export function getMondayOfWeekYmd(ymd: string): string {
  return startOfAccountingWeek(ymd, 1);
}

export function buildWeeklyBuckets(
  todayYmd: string,
  horizonWeeks: HorizonWeeks,
  weekStartsOn: number = 1,
): { startYmd: string; endYmd: string; label: string }[] {
  const startOn = normalizeWeekStartsOn(weekStartsOn);
  const firstWeekStart = startOfAccountingWeek(todayYmd, startOn);
  const buckets: { startYmd: string; endYmd: string; label: string }[] = [];

  for (let i = 0; i < horizonWeeks; i++) {
    const startYmd = addDaysYmd(firstWeekStart, i * 7);
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
  _todayYmd: string,
  _firstBucketStartYmd: string,
): string {
  // Mantém a data simulada: NÃO empurra passado para a semana 1.
  return simulatedDateYmd.slice(0, 10);
}

function resolveBucketIndex(
  assignYmd: string,
  weekDefs: { startYmd: string; endYmd: string }[],
  originalDueYmd: string,
): { index: number; clampedToHorizon: boolean } | null {
  const inRange = findBucketIndexInRange(assignYmd, weekDefs);
  if (inRange != null) {
    return { index: inRange, clampedToHorizon: false };
  }

  const lastIdx = weekDefs.length - 1;
  if (lastIdx < 0) return null;

  // Antes da semana 1 → fora do horizonte (não agrupa na semana atual).
  if (assignYmd < weekDefs[0]!.startYmd) {
    return null;
  }

  // Depois do horizonte: só extrapola itens que já estavam na janela visível.
  // Itens da folga de busca (após o horizonte) entram só se o offset os puxar para dentro.
  if (assignYmd > weekDefs[lastIdx]!.endYmd) {
    const originalInVisible =
      originalDueYmd >= weekDefs[0]!.startYmd &&
      originalDueYmd <= weekDefs[lastIdx]!.endYmd;
    if (originalInVisible) {
      return { index: lastIdx, clampedToHorizon: true };
    }
    return null;
  }

  return null;
}

export function toRawCashFlowItem(input: {
  id: string;
  direction: CashFlowDirection;
  amount: number;
  dueDateYmd: string;
  description?: string;
  counterpartyLabel?: string;
  isProjected?: boolean;
  isSettled?: boolean;
}): RawCashFlowItem {
  return {
    id: input.id,
    direction: input.direction,
    amount: input.amount,
    dueDateYmd: input.dueDateYmd.slice(0, 10),
    description: input.description,
    counterpartyLabel: input.counterpartyLabel,
    isProjected: input.isProjected,
    isSettled: input.isSettled,
  };
}

export function applyScenarioToRawItems(
  items: RawCashFlowItem[],
  scenario: ScenarioKey,
  todayYmd: string,
): CashFlowItem[] {
  return items.map((item) => {
    const baseYmd = item.dueDateYmd.slice(0, 10);
    // Liquidados: data definitiva. Pendentes: offset a partir do vencimento,
    // sem cair no passado (clamp em hoje → semana atual).
    const simulatedDateYmd = item.isSettled
      ? baseYmd
      : applyScenarioOffset(baseYmd, item.direction, scenario, todayYmd);
    return {
      ...item,
      simulatedDateYmd,
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
  /** Dia de início da semana contábil (0=dom … 6=sáb). Default: segunda. */
  weekStartsOn?: number;
}): CashFlowProjection {
  const openingBalance = parseOpeningBalance(input.openingBalance);
  const weekStartsOn = normalizeWeekStartsOn(input.weekStartsOn ?? 1);
  const weekDefs = buildWeeklyBuckets(
    input.todayYmd,
    input.horizonWeeks,
    weekStartsOn,
  );
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

    const isOverdue =
      !item.isSettled && item.dueDateYmd < input.todayYmd;
    const assignYmd = resolveBucketAssignmentYmd(
      item.simulatedDateYmd,
      input.todayYmd,
      firstBucketStart,
    );
    const resolved = resolveBucketIndex(assignYmd, weekDefs, item.dueDateYmd);
    if (!resolved) continue;

    const { index: bucketIdx, clampedToHorizon } = resolved;
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
  weekStartsOn: number = 1,
): { startYmd: string; endYmd: string } {
  // Janela = semanas do detalhamento (semana 1 = atual). Sem lookback de 90 dias
  // que puxava histórico antigo e acabava agrupado na semana 1.
  const firstWeekStart = startOfAccountingWeek(
    todayYmd,
    normalizeWeekStartsOn(weekStartsOn),
  );
  const horizonEnd = addDaysYmd(firstWeekStart, horizonWeeks * 7 - 1);
  return { startYmd: firstWeekStart, endYmd: horizonEnd };
}

/** Horizonte visível ± folga para o offset de cenário puxar contas da borda. */
export function getCashFlowFetchRangePadded(
  todayYmd: string,
  horizonWeeks: HorizonWeeks,
  weekStartsOn: number = 1,
): { startYmd: string; endYmd: string } {
  const { startYmd, endYmd } = getCashFlowFetchRange(
    todayYmd,
    horizonWeeks,
    weekStartsOn,
  );
  return {
    startYmd: addDaysYmd(startYmd, -SCENARIO_FETCH_PADDING_DAYS),
    endYmd: addDaysYmd(endYmd, SCENARIO_FETCH_PADDING_DAYS),
  };
}

import { localDateYmd } from "@/lib/boletoPayment";
import { computeCashFlowProjection } from "@/lib/cashFlowSimulation/computeCashFlowProjection";
import { fetchKnownCashFlowItems } from "@/lib/cashFlowSimulation/fetchKnownCashFlowItems";
import {
  CASH_FLOW_PREFS_STORAGE_PREFIX,
  DEFAULT_CASH_FLOW_PREFS,
  type CashFlowProjection,
  type CashFlowSimulationPrefs,
  type HorizonWeeks,
  type ScenarioKey,
} from "@/lib/cashFlowSimulation/types";
import { hasPermission } from "@/lib/permissions";
import { useCallback, useEffect, useMemo, useState } from "react";

function storageKey(companyId: string): string {
  return `${CASH_FLOW_PREFS_STORAGE_PREFIX}${companyId}`;
}

function parseHorizonWeeks(raw: unknown): HorizonWeeks {
  const n = Number(raw);
  if (n === 4 || n === 8 || n === 12) return n;
  return DEFAULT_CASH_FLOW_PREFS.horizonWeeks;
}

function parseScenario(raw: unknown): ScenarioKey {
  if (raw === "base" || raw === "optimistic" || raw === "pessimistic") {
    return raw;
  }
  return DEFAULT_CASH_FLOW_PREFS.scenario;
}

function loadPrefs(companyId: string): CashFlowSimulationPrefs {
  if (typeof window === "undefined") return { ...DEFAULT_CASH_FLOW_PREFS };
  try {
    const raw = localStorage.getItem(storageKey(companyId));
    if (!raw) return { ...DEFAULT_CASH_FLOW_PREFS };
    const parsed = JSON.parse(raw) as Partial<CashFlowSimulationPrefs>;
    return {
      openingBalance:
        typeof parsed.openingBalance === "number" &&
        Number.isFinite(parsed.openingBalance)
          ? parsed.openingBalance
          : DEFAULT_CASH_FLOW_PREFS.openingBalance,
      scenario: parseScenario(parsed.scenario),
      horizonWeeks: parseHorizonWeeks(parsed.horizonWeeks),
    };
  } catch {
    return { ...DEFAULT_CASH_FLOW_PREFS };
  }
}

function savePrefs(companyId: string, prefs: CashFlowSimulationPrefs): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(companyId), JSON.stringify(prefs));
  } catch {
    // ignore quota / private mode
  }
}

const EMPTY_PROJECTION: CashFlowProjection = {
  buckets: [],
  kpis: {
    openingBalance: 0,
    totalInflows: 0,
    totalOutflows: 0,
    minBalance: 0,
    endingBalance: 0,
  },
};

export function useCashFlowSimulation(
  companyId: string | undefined,
  permissions: readonly string[] | null | undefined,
  isCompanyOwner = false,
) {
  const [prefs, setPrefsState] = useState<CashFlowSimulationPrefs>(
    DEFAULT_CASH_FLOW_PREFS,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [projection, setProjection] = useState<CashFlowProjection>(
    EMPTY_PROJECTION,
  );
  const [itemCount, setItemCount] = useState(0);

  const includePayables =
    isCompanyOwner || hasPermission(permissions, "contas_a_pagar");
  const includeReceivables =
    isCompanyOwner || hasPermission(permissions, "vendas_realizadas");

  useEffect(() => {
    if (!companyId) return;
    setPrefsState(loadPrefs(companyId));
  }, [companyId]);

  const setPrefs = useCallback(
    (patch: Partial<CashFlowSimulationPrefs>) => {
      if (!companyId) return;
      setPrefsState((prev) => {
        const next = { ...prev, ...patch };
        savePrefs(companyId, next);
        return next;
      });
    },
    [companyId],
  );

  const setScenario = useCallback(
    (scenario: ScenarioKey) => setPrefs({ scenario }),
    [setPrefs],
  );

  const setHorizonWeeks = useCallback(
    (horizonWeeks: HorizonWeeks) => setPrefs({ horizonWeeks }),
    [setPrefs],
  );

  const setOpeningBalance = useCallback(
    (openingBalance: number) => setPrefs({ openingBalance }),
    [setPrefs],
  );

  const fetchProjection = useCallback(async () => {
    if (!companyId) {
      setProjection(EMPTY_PROJECTION);
      setItemCount(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const todayYmd = localDateYmd();

    try {
      const items = await fetchKnownCashFlowItems({
        companyId,
        todayYmd,
        horizonWeeks: prefs.horizonWeeks,
        scenario: prefs.scenario,
        includePayables,
        includeReceivables,
      });

      const result = computeCashFlowProjection({
        items,
        openingBalance: prefs.openingBalance,
        todayYmd,
        horizonWeeks: prefs.horizonWeeks,
      });

      setProjection(result);
      setItemCount(items.length);
    } catch (e) {
      console.error(e);
      setError("Não foi possível carregar a simulação de fluxo de caixa.");
      setProjection(EMPTY_PROJECTION);
      setItemCount(0);
    } finally {
      setLoading(false);
    }
  }, [
    companyId,
    prefs.horizonWeeks,
    prefs.scenario,
    prefs.openingBalance,
    includePayables,
    includeReceivables,
  ]);

  useEffect(() => {
    void fetchProjection();
  }, [fetchProjection]);

  const partialAccess = useMemo(
    () =>
      !isCompanyOwner &&
      ((includePayables && !includeReceivables) ||
        (!includePayables && includeReceivables)),
    [includePayables, includeReceivables, isCompanyOwner],
  );

  return {
    prefs,
    loading,
    error,
    projection,
    itemCount,
    includePayables,
    includeReceivables,
    partialAccess,
    setScenario,
    setHorizonWeeks,
    setOpeningBalance,
    retry: fetchProjection,
  };
}

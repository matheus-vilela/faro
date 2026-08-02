import { localDateYmd } from "@/lib/boletoPayment";
import { computeCashFlowProjection } from "@/lib/cashFlowSimulation/computeCashFlowProjection";
import { fetchCashFlowDiagnostics } from "@/lib/cashFlowSimulation/fetchCashFlowDiagnostics";
import { fetchKnownCashFlowItems } from "@/lib/cashFlowSimulation/fetchKnownCashFlowItems";
import { fetchOpeningBalanceHint } from "@/lib/cashFlowSimulation/fetchOpeningBalanceHint";
import {
  CASH_FLOW_PREFS_STORAGE_PREFIX,
  DEFAULT_CASH_FLOW_PREFS,
  type CashFlowDiagnostics,
  type CashFlowSimulationPrefs,
  type HorizonWeeks,
  type OpeningBalanceHint,
  type RawCashFlowItem,
  type ScenarioKey,
} from "@/lib/cashFlowSimulation/types";
import { hasPermission } from "@/lib/permissions";
import { normalizeWeekStartsOn } from "@/lib/vendasRealizadasResumo";
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

const EMPTY_DIAGNOSTICS: CashFlowDiagnostics = {
  pendingInHorizon: 0,
  pendingOutsideHorizon: 0,
  overduePendingCount: 0,
  overduePendingPayablesAmount: 0,
  overduePendingReceivablesAmount: 0,
};

const EMPTY_HINT: OpeningBalanceHint = {
  paidInflows30: 0,
  paidOutflows30: 0,
  netPaid30: 0,
  overduePendingPayablesAmount: 0,
  overduePendingReceivablesAmount: 0,
};

export function useCashFlowSimulation(
  companyId: string | undefined,
  permissions: readonly string[] | null | undefined,
  isCompanyOwner = false,
  accountingWeekStartsOn: number | null | undefined = 1,
) {
  const weekStartsOn = normalizeWeekStartsOn(accountingWeekStartsOn);
  const [prefs, setPrefsState] = useState<CashFlowSimulationPrefs>(
    DEFAULT_CASH_FLOW_PREFS,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawItems, setRawItems] = useState<RawCashFlowItem[]>([]);
  const [todayYmd, setTodayYmd] = useState(() => localDateYmd());
  const [diagnostics, setDiagnostics] =
    useState<CashFlowDiagnostics>(EMPTY_DIAGNOSTICS);
  const [openingBalanceHint, setOpeningBalanceHint] =
    useState<OpeningBalanceHint>(EMPTY_HINT);

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

  const fetchData = useCallback(async () => {
    if (!companyId) {
      setRawItems([]);
      setDiagnostics(EMPTY_DIAGNOSTICS);
      setOpeningBalanceHint(EMPTY_HINT);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const fetchedTodayYmd = localDateYmd();
    setTodayYmd(fetchedTodayYmd);

    try {
      const [items, hint] = await Promise.all([
        fetchKnownCashFlowItems({
          companyId,
          todayYmd: fetchedTodayYmd,
          horizonWeeks: prefs.horizonWeeks,
          includePayables,
          includeReceivables,
          weekStartsOn,
        }),
        fetchOpeningBalanceHint({
          companyId,
          todayYmd: fetchedTodayYmd,
          includePayables,
          includeReceivables,
        }),
      ]);

      const diag = await fetchCashFlowDiagnostics({
        companyId,
        todayYmd: fetchedTodayYmd,
        horizonWeeks: prefs.horizonWeeks,
        pendingInHorizon: items.length,
        includePayables,
        includeReceivables,
        weekStartsOn,
      });

      setRawItems(items);
      setDiagnostics(diag);
      setOpeningBalanceHint(hint);
    } catch (e) {
      console.error(e);
      setError("Não foi possível carregar a simulação de fluxo de caixa.");
      setRawItems([]);
      setDiagnostics(EMPTY_DIAGNOSTICS);
      setOpeningBalanceHint(EMPTY_HINT);
    } finally {
      setLoading(false);
    }
  }, [
    companyId,
    prefs.horizonWeeks,
    includePayables,
    includeReceivables,
    weekStartsOn,
  ]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const projection = useMemo(
    () =>
      computeCashFlowProjection({
        rawItems,
        scenario: prefs.scenario,
        openingBalance: prefs.openingBalance,
        todayYmd,
        horizonWeeks: prefs.horizonWeeks,
        weekStartsOn,
      }),
    [
      rawItems,
      prefs.scenario,
      prefs.openingBalance,
      prefs.horizonWeeks,
      todayYmd,
      weekStartsOn,
    ],
  );

  const partialAccess = useMemo(
    () =>
      !isCompanyOwner &&
      ((includePayables && !includeReceivables) ||
        (!includePayables && includeReceivables)),
    [includePayables, includeReceivables, isCompanyOwner],
  );

  const hasVisibleMovements = projection.kpis.totalInflows > 0 ||
    projection.kpis.totalOutflows > 0;

  return {
    prefs,
    loading,
    error,
    projection,
    rawItems,
    diagnostics,
    openingBalanceHint,
    itemCount: rawItems.length,
    hasVisibleMovements,
    includePayables,
    includeReceivables,
    partialAccess,
    setScenario,
    setHorizonWeeks,
    setOpeningBalance,
    retry: fetchData,
  };
}

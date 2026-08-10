import { useCallback, useState } from "react";
import type { ResumoPeriodFilter } from "@/lib/vendasRealizadasResumo";

export type DashboardHomePeriod = Extract<
  ResumoPeriodFilter,
  "today" | "last7" | "month"
>;

const PERIOD_OPTIONS: { value: DashboardHomePeriod; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "last7", label: "Semana" },
  { value: "month", label: "Mês" },
];

export function useDashboardHomePeriod(
  initial: DashboardHomePeriod = "last7",
) {
  const [period, setPeriod] = useState<DashboardHomePeriod>(initial);
  const selectPeriod = useCallback((next: DashboardHomePeriod) => {
    setPeriod(next);
  }, []);
  return { period, setPeriod: selectPeriod, options: PERIOD_OPTIONS };
}

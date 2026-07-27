import type { MonthYear } from "@/components/MonthSelector";
import type { DreComputed } from "./computeDre";
import { formatBrl } from "./formatBrl";
import { pontoEquilibrioReceita } from "./dreIndicators";

export function shiftMonth(period: MonthYear, delta: number): MonthYear {
  const d = new Date(period.year, period.month - 1 + delta, 1);
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

export function momPercent(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export function formatMomDelta(pct: number | null): string {
  if (pct == null) return "—";
  const sign = pct > 0 ? "▲" : pct < 0 ? "▼" : "•";
  const abs = Math.abs(pct).toLocaleString("pt-BR", {
    maximumFractionDigits: 0,
  });
  return `${sign} ${abs}%`;
}

/**
 * Dia estimado do break-even no mês (1–diasDoMês), assumindo vendas lineares.
 * null se PE inválido ou sem vendas.
 */
export function estimateBreakEvenDay(
  computed: DreComputed,
  period: MonthYear,
): number | null {
  const pe = pontoEquilibrioReceita(computed);
  if (pe.reason !== "ok" || pe.value <= 0) return null;
  const vl = computed.vendasLiquidas;
  if (vl <= 0) return null;
  const daysInMonth = new Date(period.year, period.month, 0).getDate();
  const day = Math.ceil((pe.value / vl) * daysInMonth);
  return Math.min(daysInMonth, Math.max(1, day));
}

export function buildDreInsight(input: {
  computed: DreComputed;
  periodLabel: string;
  previousLucro: number | null;
  semCategoriaTotal: number;
}): string {
  const { computed, previousLucro, semCategoriaTotal } = input;
  const ll = computed.lucroLiquido;
  const margem =
    computed.vendasLiquidas > 0
      ? (ll / computed.vendasLiquidas) * 100
      : null;

  if (computed.vendasLiquidas <= 0 && computed.despesasFixas <= 0 && computed.cmv <= 0) {
    if (semCategoriaTotal > 0) {
      return `Há ${formatBrl(semCategoriaTotal)} em lançamentos sem categoria neste mês — classifique-os para o resultado aparecer.`;
    }
    return "Ainda não há movimento classificado neste período. Quando houver vendas e despesas no plano de contas, o resultado aparece aqui.";
  }

  const parts: string[] = [];
  if (ll >= 0) {
    parts.push(
      `Esse mês sobrou ${formatBrl(ll)} no resultado${
        margem != null
          ? ` — ${margem.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% do que você vendeu`
          : ""
      }.`,
    );
  } else {
    parts.push(
      `Esse mês o resultado ficou negativo em ${formatBrl(Math.abs(ll))}.`,
    );
  }

  if (previousLucro != null && previousLucro !== 0) {
    const delta = momPercent(ll, previousLucro);
    if (delta != null && Math.abs(delta) >= 1) {
      parts.push(
        delta >= 0
          ? `É ${Math.abs(delta).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% a mais que o mês anterior.`
          : `É ${Math.abs(delta).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% a menos que o mês anterior.`,
      );
    }
  }

  const pe = pontoEquilibrioReceita(computed);
  if (pe.reason === "ok" && computed.vendasLiquidas >= pe.value) {
    parts.push("Você passou do ponto de equilíbrio.");
  } else if (pe.reason === "ok" && pe.value > computed.vendasLiquidas) {
    parts.push(
      `Faltam ${formatBrl(pe.value - computed.vendasLiquidas)} de vendas líquidas para o equilíbrio.`,
    );
  }

  if (semCategoriaTotal > 0) {
    parts.push(
      `Atenção: ${formatBrl(semCategoriaTotal)} ainda está sem classificação.`,
    );
  }

  return parts.join(" ");
}

/** Projeção linear do lucro líquido até o fim do mês. */
export function projectMonthEndLucro(
  lucroAtual: number,
  period: MonthYear,
  today: Date = new Date(),
): { projected: number; daysLeft: number } | null {
  if (today.getFullYear() !== period.year || today.getMonth() + 1 !== period.month) {
    return null;
  }
  const day = today.getDate();
  const daysInMonth = new Date(period.year, period.month, 0).getDate();
  if (day <= 0) return null;
  const projected = (lucroAtual / day) * daysInMonth;
  return { projected, daysLeft: Math.max(0, daysInMonth - day) };
}

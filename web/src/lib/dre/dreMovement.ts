import type { DreComputed } from "./computeDre";
import type { CategoryTotals } from "./computeDre";

/** Há movimento classificado no P&L (buckets ou CMV de vendas). */
export function dreHasMappedMovement(
  computed: DreComputed | null,
  salesCmvInPeriod: number,
  categoryTotals: CategoryTotals,
): boolean {
  if (!computed) return false;
  if (salesCmvInPeriod > 0) return true;
  if (categoryTotals.byCategoryId.size > 0) return true;
  return (
    computed.vendasBrutas > 0 ||
    computed.deducoesReceita > 0 ||
    computed.cmv > 0 ||
    computed.despesasVariaveis > 0 ||
    computed.despesasFixas > 0 ||
    computed.resultadoFinanceiroReceitas > 0 ||
    computed.resultadoFinanceiroDespesas > 0 ||
    computed.impostos > 0
  );
}

/** Há boletos no período, mas nada entra nos buckets DRE — tipicamente sem categoria. */
export function dreHasOnlyUnclassified(
  boletosInPeriodCount: number,
  hasMapped: boolean,
  semCategoriaCount: number,
): boolean {
  return boletosInPeriodCount > 0 && !hasMapped && semCategoriaCount > 0;
}

/** Lucro gerencial após reservar lançamentos sem classificação (despesas). */
export function lucroLiquidoGerencial(
  lucroLiquido: number,
  semCategoriaTotal: number,
): number {
  return lucroLiquido - Math.max(0, semCategoriaTotal);
}

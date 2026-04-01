import type { CompanyCategory } from "@/types/category";
import type { DreBucket } from "./dreMapping";
import { mapCategoryToDreBucket } from "./dreMapping";

export interface DreComputed {
  vendasBrutas: number;
  deducoesReceita: number;
  vendasLiquidas: number;
  cmv: number;
  lucroBruto: number;
  despesasVariaveis: number;
  despesasFixas: number;
  resultadoOperacional: number;
  resultadoFinanceiroReceitas: number;
  resultadoFinanceiroDespesas: number;
  resultadoFinanceiroLiquido: number;
  resultadoAntesImposto: number;
  impostos: number;
  lucroLiquido: number;
}

/**
 * Fórmulas obrigatórias (valores numéricos; deduções e despesas entram como positivos).
 */
export function computeDreLines(input: {
  vendasBrutas: number;
  deducoesReceita: number;
  cmv: number;
  despesasVariaveis: number;
  despesasFixas: number;
  resultadoFinanceiroReceitas: number;
  resultadoFinanceiroDespesas: number;
  impostos: number;
}): DreComputed {
  const vendasLiquidas = input.vendasBrutas - input.deducoesReceita;
  const lucroBruto = vendasLiquidas - input.cmv;
  const resultadoOperacional =
    lucroBruto - input.despesasVariaveis - input.despesasFixas;
  const resultadoFinanceiroLiquido =
    input.resultadoFinanceiroReceitas - input.resultadoFinanceiroDespesas;
  const resultadoAntesImposto = resultadoOperacional + resultadoFinanceiroLiquido;
  const lucroLiquido = resultadoAntesImposto - input.impostos;

  return {
    vendasBrutas: input.vendasBrutas,
    deducoesReceita: input.deducoesReceita,
    vendasLiquidas,
    cmv: input.cmv,
    lucroBruto,
    despesasVariaveis: input.despesasVariaveis,
    despesasFixas: input.despesasFixas,
    resultadoOperacional,
    resultadoFinanceiroReceitas: input.resultadoFinanceiroReceitas,
    resultadoFinanceiroDespesas: input.resultadoFinanceiroDespesas,
    resultadoFinanceiroLiquido,
    resultadoAntesImposto,
    impostos: input.impostos,
    lucroLiquido,
  };
}

export interface CategoryTotals {
  byCategoryId: Map<string, number>;
  unmappedCategoryIds: Set<string>;
  /** Soma dos lançamentos em categorias excluídas por mapeamento UNMAPPED. */
  unmappedTotal: number;
  semCategoriaCount: number;
  semCategoriaTotal: number;
}

/** Agrega valores por categoria e detecta não mapeadas / sem categoria. */
export function aggregateTotalsByCategory(
  rows: Array<{
    amount: number;
    company_category_id: string | null;
  }>,
  categoriesById: Map<string, CompanyCategory>,
): CategoryTotals {
  const byCategoryId = new Map<string, number>();
  const unmappedCategoryIds = new Set<string>();
  let unmappedTotal = 0;
  let semCategoriaCount = 0;
  let semCategoriaTotal = 0;

  for (const row of rows) {
    const amt = Number(row.amount);
    if (!Number.isFinite(amt)) continue;

    if (!row.company_category_id) {
      semCategoriaCount += 1;
      semCategoriaTotal += Math.abs(amt);
      continue;
    }

    const cat = categoriesById.get(row.company_category_id);
    if (!cat) {
      unmappedCategoryIds.add(row.company_category_id);
      continue;
    }

    const bucket = mapCategoryToDreBucket(cat);
    if (bucket === "EXCLUDE") {
      continue;
    }
    if (bucket === "UNMAPPED") {
      unmappedCategoryIds.add(cat.id);
      unmappedTotal += Math.abs(amt);
      continue;
    }

    const prev = byCategoryId.get(row.company_category_id) ?? 0;
    byCategoryId.set(row.company_category_id, prev + amt);
  }

  return {
    byCategoryId,
    unmappedCategoryIds,
    unmappedTotal,
    semCategoriaCount,
    semCategoriaTotal,
  };
}

/** Soma totais de todas as categorias cujo bucket DRE é o informado. */
export function sumForBucket(
  byCategoryId: Map<string, number>,
  categoriesById: Map<string, CompanyCategory>,
  bucket: DreBucket,
): number {
  let s = 0;
  for (const [id, v] of byCategoryId) {
    const c = categoriesById.get(id);
    if (!c) continue;
    if (mapCategoryToDreBucket(c) === bucket) s += v;
  }
  return s;
}

export function buildDreComputedFromMaps(
  byCategoryId: Map<string, number>,
  categoriesById: Map<string, CompanyCategory>,
): DreComputed {
  const vendasBrutas = sumForBucket(byCategoryId, categoriesById, "VENDAS_BRUTAS");
  const deducoesReceita = sumForBucket(byCategoryId, categoriesById, "DEDUCAO_RECEITA");
  const cmv = sumForBucket(byCategoryId, categoriesById, "CMV");
  const despesasVariaveis = sumForBucket(byCategoryId, categoriesById, "DESPESAS_VARIAVEIS");
  const despesasFixas = sumForBucket(byCategoryId, categoriesById, "DESPESAS_FIXAS");
  const resultadoFinanceiroReceitas = sumForBucket(
    byCategoryId,
    categoriesById,
    "RESULTADO_FINANCEIRO_RECEITA",
  );
  const resultadoFinanceiroDespesas = sumForBucket(
    byCategoryId,
    categoriesById,
    "RESULTADO_FINANCEIRO_DESPESA",
  );
  const impostos = sumForBucket(byCategoryId, categoriesById, "IMPOSTOS");

  return computeDreLines({
    vendasBrutas,
    deducoesReceita,
    cmv,
    despesasVariaveis,
    despesasFixas,
    resultadoFinanceiroReceitas,
    resultadoFinanceiroDespesas,
    impostos,
  });
}

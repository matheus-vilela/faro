/**
 * Regras de mapeamento categoria → blocos da DRE.
 *
 * FALLBACK / riscos documentados:
 * - RECEITA OPERACIONAL sem papel_receita_dre explícito conta como VENDAS_BRUTAS (inclui NULL e BRUTA).
 * - RECEITA NÃO OPERACIONAL inteira entra no "Resultado financeiro" junto com despesas de
 *   INVESTIMENTOS_FINANCIAMENTOS: em negócios reais parte pode ser não financeira — revisar
 *   classificação nas categorias se precisar separar.
 * - Categorias com combinação natureza/tipo inválida ou não prevista → UNMAPPED (fora do P&L).
 */

import type { CompanyCategory } from "@/types/category";

export type DreBucket =
  | "VENDAS_BRUTAS"
  | "DEDUCAO_RECEITA"
  | "CMV"
  | "DESPESAS_VARIAVEIS"
  | "DESPESAS_FIXAS"
  | "RESULTADO_FINANCEIRO_RECEITA"
  | "RESULTADO_FINANCEIRO_DESPESA"
  | "IMPOSTOS"
  | "UNMAPPED";

/** Determina o bucket DRE para uma categoria (folha ou nó — nós seguem o tipo da própria linha). */
export function mapCategoryToDreBucket(cat: CompanyCategory): DreBucket | "EXCLUDE" {
  if (cat.incluir_no_dre === false) return "EXCLUDE";

  if (cat.natureza === "RECEITA" && cat.tipo === "OPERACIONAL") {
    if (cat.papel_receita_dre === "DEDUCAO") return "DEDUCAO_RECEITA";
    return "VENDAS_BRUTAS";
  }

  if (cat.natureza === "RECEITA" && cat.tipo === "NAO_OPERACIONAL") {
    return "RESULTADO_FINANCEIRO_RECEITA";
  }

  if (cat.natureza === "DESPESA") {
    switch (cat.tipo) {
      case "CMV":
        return "CMV";
      case "VARIAVEL":
        return "DESPESAS_VARIAVEIS";
      case "FIXA":
        return "DESPESAS_FIXAS";
      case "IMPOSTOS":
        return "IMPOSTOS";
      case "INVESTIMENTOS_FINANCIAMENTOS":
        return "RESULTADO_FINANCEIRO_DESPESA";
      default:
        return "UNMAPPED";
    }
  }

  return "UNMAPPED";
}

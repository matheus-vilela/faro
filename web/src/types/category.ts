export type NaturezaCategoria = "RECEITA" | "DESPESA"
export type TipoCategoria =
  | "OPERACIONAL"
  | "NAO_OPERACIONAL"
  | "CMV"
  | "VARIAVEL"
  | "FIXA"
  | "IMPOSTOS"
  | "INVESTIMENTOS_FINANCIAMENTOS"

/** Somente receita operacional na DRE: vendas brutas vs. deduções (contra-receita). */
export type PapelReceitaDre = "BRUTA" | "DEDUCAO"

export interface CompanyCategory {
  id: string
  company_id: string
  parent_id: string | null
  name: string
  sort_order: number
  ordem?: number
  created_at: string
  updated_at: string
  natureza: NaturezaCategoria
  tipo: TipoCategoria
  ativo?: boolean
  padrao_sistema?: boolean
  incluir_no_dre?: boolean
  papel_receita_dre?: PapelReceitaDre | null
}

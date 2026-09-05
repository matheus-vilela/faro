export interface CompanyProductCategory {
  id: string
  company_id: string
  name: string
  sort_order: number
  /** true = produtos desta categoria não aparecem como venda. */
  exclude_from_sales?: boolean
  /** Folha de company_categories usada na linha da nota. */
  default_dre_category_id?: string | null
  padrao_sistema?: boolean
  ativo?: boolean
  created_at: string
  updated_at: string
}

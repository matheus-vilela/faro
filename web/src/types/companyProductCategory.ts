export interface CompanyProductCategory {
  id: string
  company_id: string
  name: string
  sort_order: number
  /** true = produtos desta categoria não aparecem como venda. */
  exclude_from_sales?: boolean
  created_at: string
  updated_at: string
}

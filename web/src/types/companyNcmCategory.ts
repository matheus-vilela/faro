export interface CompanyNcmCategoryRule {
  id: string
  company_id: string
  ncm: string
  product_category_id: string
  created_at: string
  updated_at: string
}

export type CompanyNcmListFilter = "unmapped" | "all" | "mapped"

export interface CompanyNcmRow {
  ncm: string
  productCount: number
  expenseItemCount: number
  sampleProductNames: string[]
  /** Categoria de produto vinculada ao NCM. */
  categoryId: string | null
  dreCategoryId: string | null
}

export interface CompanyNcmProductRow {
  id: string
  name: string
  unit: string | null
}

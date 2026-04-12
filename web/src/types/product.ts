export interface Product {
  id: string
  company_id: string
  name: string
  sku: string | null
  unit: string
  min_quantity: number
  current_quantity: number
  last_unit_value: number | null
  /** Legado; CMV na venda usa a folha CMV padrão da empresa. */
  cmv_category_id?: string | null
  /** Se true, vendas geram lançamento de CMV; se false, não compõe CMV no DRE. */
  composes_cmv?: boolean
  /** Custo médio ponderado (CMV), quando houver entradas valoradas */
  average_cost?: number | null
  /** Código para etiqueta (EAN/Code128) */
  barcode?: string | null
  is_active?: boolean
  created_at: string
  updated_at: string
  /** Colunas geradas (migração stock alert) — opcionais até o banco atualizar */
  stock_is_zero?: boolean
  stock_below_min_positive?: boolean
  stock_below_min_inclusive?: boolean
  stock_has_alert?: boolean
}

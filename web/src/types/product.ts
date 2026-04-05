export interface Product {
  id: string
  company_id: string
  name: string
  sku: string | null
  unit: string
  min_quantity: number
  current_quantity: number
  last_unit_value: number | null
  /** Folha DESPESA tipo CMV: grupo de custo no DRE em vendas deste produto (obrigatório para venda pontual) */
  cmv_category_id?: string | null
  /** Custo médio ponderado (CMV), quando houver entradas valoradas */
  average_cost?: number | null
  /** Código para etiqueta (EAN/Code128) */
  barcode?: string | null
  is_active?: boolean
  created_at: string
  updated_at: string
}

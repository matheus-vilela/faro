export interface Product {
  id: string
  company_id: string
  name: string
  sku: string | null
  unit: string
  min_quantity: number
  current_quantity: number
  last_unit_value: number | null
  created_at: string
  updated_at: string
}

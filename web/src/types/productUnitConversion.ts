export interface ProductUnitConversion {
  id: string
  company_id: string
  product_id: string
  primary_qty: number
  primary_unit_code: string
  secondary_qty: number
  secondary_unit_code: string
  created_at?: string
}

export type ProductUnitConversionDraft = {
  id?: string
  company_id: string
  product_id?: string
  primary_qty: number
  primary_unit_code: string
  secondary_qty: number
  secondary_unit_code: string
}

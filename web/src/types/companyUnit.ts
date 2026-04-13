export interface CompanyUnit {
  id: string
  company_id: string
  code: string
  label: string
  sort_order: number
  is_primary: boolean
  created_at?: string
  updated_at?: string
}

export interface CompanyUnitConversion {
  id: string
  company_id: string
  primary_qty: number
  primary_unit_id: string
  secondary_qty: number
  secondary_unit_id: string
  created_at?: string
}
